#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * tools/build_courses.js
 *
 * data/courses/raw/{course}.geojson を読み、以下を行って data/courses/{course}.json
 * を生成する:
 *   1. ストライドサンプリングで 100-200 点に間引き (Phase 3 ではこれで十分)
 *   2. 各点に GSI getelevation API で標高を付与 (200ms 間隔)
 *   3. 累積標高・標準時間・コース定数を計算
 *   4. OSM 各 segment の description を CP / itinerary / segments テーブルに展開
 *   5. 共通の gear / emergency / signal / notes テンプレートを差し込む
 *
 * Usage:
 *   node tools/build_courses.js                  # 全コース
 *   node tools/build_courses.js --courses higashiyama,kitayama-east
 *   node tools/build_courses.js --skip-elevation # 標高 API 呼び出しをスキップ (デバッグ用)
 *   node tools/build_courses.js --target-points 120
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data/courses/raw');
const OUT_DIR = path.join(ROOT, 'data/courses');

const GSI_ELEV_URL = 'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php';
const GSI_DELAY_MS = 200;

const COURSE_META = {
  higashiyama: {
    name: '東山コース',
    subtitle: '京阪伏見桃山駅〜ケーブル比叡駅',
    osmRange: 'F1-F35 + 1-74',
    osmCoverageNote: 'OpenStreetMap 上で全 marker（F1〜F35 + 1〜74）がマッピング済みのため、フルカバレッジ。'
  },
  'kitayama-east': {
    name: '北山東部コース',
    subtitle: 'ケーブル比叡駅〜二ノ瀬',
    osmRange: '1-46',
    osmCoverageNote: 'OpenStreetMap 上の marker 1〜46 をフルカバー。'
  },
  'kitayama-west': {
    name: '北山西部コース',
    subtitle: '二ノ瀬〜高雄〜清滝',
    osmRange: '46-94 (一部 marker 70-90 が OSM 未マップ)',
    osmCoverageNote: 'OpenStreetMap 上で marker 70〜90 のセグメントが現状未マッピング。実際のコース長は約 19.5km だが本データはおおよそ 17km 分のみ。'
  },
  nishiyama: {
    name: '西山コース',
    subtitle: '高雄〜嵐山〜苔寺',
    osmRange: '1-5-2 (大部分が OSM 未マップ)',
    osmCoverageNote: 'OpenStreetMap が部分しかカバーしないため、本リポジトリでは合成データを採用 (このスクリプトでは生成しない)。'
  }
};

const TARGET_POINTS_DEFAULT = 150;

// ---------- args ----------

function parseArgs(argv) {
  const args = { courses: null, targetPoints: TARGET_POINTS_DEFAULT, skipElevation: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--courses' && argv[i + 1]) args.courses = argv[++i].split(',');
    else if (argv[i] === '--target-points' && argv[i + 1]) args.targetPoints = parseInt(argv[++i], 10);
    else if (argv[i] === '--skip-elevation') args.skipElevation = true;
    else if (argv[i] === '-h' || argv[i] === '--help') { console.log('see file header'); process.exit(0); }
    else throw new Error('Unknown arg: ' + argv[i]);
  }
  return args;
}

// ---------- HTTP ----------

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      method: 'GET', hostname: u.hostname, port: u.port || 443,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'kyototrailplan05/0.1 (https://github.com/Funmatu/kyototrailplan05)' }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode));
        else resolve(data);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchElevation(lat, lon) {
  const url = `${GSI_ELEV_URL}?lat=${lat}&lon=${lon}&outtype=JSON`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const txt = await httpGet(url);
      const json = JSON.parse(txt);
      if (json && typeof json.elevation === 'number') return json.elevation;
      if (json && json.elevation === '-----') return null;          // out of DEM coverage
      return null;
    } catch (e) {
      if (attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
      console.warn(`  ! elev failed @ ${lat},${lon}: ${e.message.slice(0, 100)}`);
      return null;
    }
  }
}

// ---------- geometry helpers ----------

function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}

function totalDistanceKm(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversineKm(coords[i - 1], coords[i]);
  return d;
}

function cumulativeAscentDescent(coordsWithEle) {
  let asc = 0, desc = 0;
  for (let i = 1; i < coordsWithEle.length; i++) {
    const dE = (coordsWithEle[i][2] || 0) - (coordsWithEle[i - 1][2] || 0);
    if (dE > 0) asc += dE; else desc += -dE;
  }
  return { asc, desc };
}

function findPeaks(coordsWithEle, distancesKm) {
  // Local maxima within a 3-km neighborhood
  const peaks = [];
  for (let i = 5; i < coordsWithEle.length - 5; i++) {
    const eHere = coordsWithEle[i][2];
    if (eHere == null) continue;
    let isPeak = true;
    const dHere = distancesKm[i];
    for (let j = i - 1; j >= 0 && (dHere - distancesKm[j]) <= 1.5; j--) {
      if ((coordsWithEle[j][2] || -Infinity) > eHere) { isPeak = false; break; }
    }
    if (!isPeak) continue;
    for (let j = i + 1; j < coordsWithEle.length && (distancesKm[j] - dHere) <= 1.5; j++) {
      if ((coordsWithEle[j][2] || -Infinity) > eHere) { isPeak = false; break; }
    }
    if (isPeak && eHere >= 200) {
      peaks.push({
        lat: Math.round(coordsWithEle[i][1] * 10000) / 10000,
        lng: Math.round(coordsWithEle[i][0] * 10000) / 10000,
        elevationM: Math.round(eHere),
        distanceKm: Math.round(dHere * 100) / 100
      });
    }
  }
  // Dedup peaks within 1 km of each other, keep highest
  const merged = [];
  for (const p of peaks) {
    const near = merged.find(q => Math.abs(q.distanceKm - p.distanceKm) < 1.0);
    if (!near) merged.push(p);
    else if (p.elevationM > near.elevationM) {
      Object.assign(near, p);
    }
  }
  return merged;
}

// ---------- segment / waypoint extraction ----------

/**
 * "Aから B" もしくは "AからBまで" の description から始終点を抽出。
 */
function parseFromTo(description) {
  if (!description) return { from: null, to: null };
  const m = description.match(/^(.+?)から(.+?)(まで)?$/);
  if (!m) return { from: null, to: null };
  return { from: m[1].replace(/[（(].*?[)）]/g, '').trim(), to: m[2].replace(/[（(].*?[)）]/g, '').trim() };
}

/**
 * Build the ordered checkpoint list from the segments' from/to descriptions.
 * Each unique waypoint appears once; consecutive duplicates are dropped.
 */
function checkpointsFromSegments(segments) {
  const points = [];
  for (const s of segments) {
    const { from, to } = parseFromTo(s.description);
    if (from && (!points.length || points[points.length - 1].name !== from)) {
      points.push({ name: from, _origin: 'from', _segName: s.name });
    }
    if (to && (!points.length || points[points.length - 1].name !== to)) {
      points.push({ name: to, _origin: 'to', _segName: s.name });
    }
  }
  return points;
}

/**
 * Lay the checkpoint sequence onto the LineString by snapping each waypoint to its
 * segment's start/end coordinates (which we recorded in the raw geojson).
 */
function placeCheckpointsOnLine(points, segments, sampledCoords) {
  // For each waypoint, pick the nearest sampled coord to its known anchor.
  const cps = [];
  for (let idx = 0; idx < points.length; idx++) {
    const wp = points[idx];
    const seg = segments.find(s => s.name === wp._segName);
    if (!seg) continue;
    const anchor = wp._origin === 'from' ? seg.startLatLng : seg.endLatLng;
    if (!anchor) continue;
    // Find nearest sampled point
    let bestIdx = 0, bestDistKm = Infinity;
    for (let i = 0; i < sampledCoords.length; i++) {
      const d = haversineKm([anchor[1], anchor[0]], [sampledCoords[i][0], sampledCoords[i][1]]);
      if (d < bestDistKm) { bestDistKm = d; bestIdx = i; }
    }
    cps.push({
      name: wp.name,
      coordIdx: bestIdx,
      lat: anchor[0],
      lng: anchor[1]
    });
  }
  // Dedup by name (keep first occurrence)
  const seen = new Set();
  const dedup = cps.filter(c => {
    if (seen.has(c.name)) return false;
    seen.add(c.name); return true;
  });
  return dedup.sort((a, b) => a.coordIdx - b.coordIdx);
}

function inferCheckpointType(name, isFirst, isLast, distanceKm) {
  if (isFirst) return ['START'];
  if (isLast) return ['GOAL'];
  if (/(駅|バス停|ケーブル)/.test(name)) return ['REST'];
  if (/(山頂|峠|山|岳|展望|公園)/.test(name)) return ['PEAK'];
  if (/(神社|寺|院|塔|大社|鳥居)/.test(name)) return ['REST'];
  return [];
}

// ---------- shared content templates ----------

const SHARED_GEAR = {
  groups: [
    {
      title: 'ウェア',
      items: [
        { name: '吸汗速乾ベースレイヤー' },
        { name: 'フリースまたは薄手インサレーション', note: '稜線上は市街地より気温が低く、風が吹くと体感温度がさらに下がる。' },
        { name: 'レインウェア上下（防風兼用）', note: 'ゴアテックス等の防水透湿素材推奨。' },
        { name: 'トレッキングパンツ（ストレッチ素材）' },
        { name: '替え靴下' }
      ]
    },
    {
      title: 'フットウェア',
      items: [
        { name: 'トレッキングシューズ（ミドルカット以上推奨）', note: '岩場・急斜面あり。ローカットは捻挫リスクあり。' },
        { name: 'ゲイター（雨天・ぬかるみ時）' }
      ]
    },
    {
      title: 'ザック・携行品',
      items: [
        { name: 'ザック（20〜30L）' },
        { name: 'ザックカバー' },
        { name: 'トレッキングポール', note: '長距離・累積標高が大きいコースで膝負担を軽減。強く推奨。' },
        { name: 'ヘッドランプ + 予備電池', note: '日没リスク・トンネル通過時に必要。' }
      ]
    },
    {
      title: '水分・食料',
      items: [
        { name: '水 1.5L以上（夏季は2.0L以上）' },
        { name: '行動食（おにぎり・パン・エナジーバー等）' },
        { name: '昼食' },
        { name: '非常食（カロリーメイト等1個）' },
        { name: '電解質タブレット or スポーツドリンク粉末' }
      ]
    },
    {
      title: 'ナビゲーション・通信',
      items: [
        { name: 'スマートフォン（GPS・本アプリ）' },
        { name: 'モバイルバッテリー（10000mAh以上推奨）', note: 'GPS常時ONでバッテリー消費が大きい。予備電源は必須。' },
        { name: '紙の地図（京都一周トレイル公式マップ）', note: '京都市観光協会で購入可。' },
        { name: 'コンパス' }
      ]
    },
    {
      title: '安全・救急',
      items: [
        { name: 'ファーストエイドキット', note: '絆創膏・テーピング・消毒液・鎮痛剤・虫刺され薬。' },
        { name: 'エマージェンシーシート' },
        { name: 'ホイッスル' },
        { name: '保険証コピー' },
        { name: '登山届（コンパス等で提出済み）' },
        { name: '現金（小銭含む、バス・自販機用）' }
      ]
    }
  ],
  seasonal: [
    { season: '春（3〜5月）', items: '花粉対策マスク、薄手グローブ、日焼け止め' },
    { season: '夏（6〜8月）', items: '帽子（日よけ付き）、虫除けスプレー、塩分タブレット、速乾タオル' },
    { season: '秋（9〜11月）', items: '防寒ミドルレイヤー、ニット帽、手袋' },
    { season: '冬（12〜2月）', items: 'ダウンジャケット、厚手グローブ、ネックウォーマー、チェーンスパイク（降雪時）' }
  ],
  weightNote: '装備重量を軽く保つことで膝への負担と消費カロリーを抑えられます。不要な荷物は持たないこと。'
};

const SHARED_EMERGENCY_CONTACTS = [
  { label: '警察（事件・事故）', tel: '110' },
  { label: '消防・救急', tel: '119' },
  { label: '山岳遭難 京都府警', tel: '075-751-4141' }
];

const SHARED_RESCUE_PROCEDURE = [
  '安全な場所に移動（崖際・落石危険区域から離れる）',
  '119番に電話。「山岳事故です」と告げ、京都一周トレイル○○コース（標識番号付近）と本アプリの座標表示を読み上げ。傷病者の状態・人数、連絡可能な電話番号も伝える。',
  'ホイッスルを6回吹く（国際山岳遭難信号）→1分待ち→繰り返し',
  'エマージェンシーシートで保温。動かさない（骨折疑い時）',
  '電池を節約。機内モードにしてGPSのみONにする手もある。'
];

const SHARED_WEATHER_CRITERIA = [
  { condition: '降水確率 60%以上', judgment: '中止を強く推奨', severity: 'danger' },
  { condition: '降水確率 40〜60%', judgment: 'レインウェア必携で判断。雷注意報なら中止。', severity: 'warning' },
  { condition: '風速 15m/s以上の予報', judgment: '稜線通過は極めて危険。中止。', severity: 'danger' },
  { condition: '気温 35℃以上', judgment: '熱中症リスク極大。早朝出発 or 中止。', severity: 'warning' },
  { condition: '気温 0℃以下', judgment: '凍結リスク。チェーンスパイク携行。', severity: 'warning' }
];

const SHARED_MARKING = {
  summary: '京都一周トレイルは京都市が整備した公式コース。標識は赤地に白文字の番号標識（コース略名+番号）が設置されている。分岐点には方向を示す矢印標識あり。',
  tips: [
    '標識間隔は概ね200〜500m。5分以上標識が見つからない場合はルートミスの可能性。',
    'GPS（本アプリ）と紙地図を併用し、定期的に現在地を確認すること。',
    '不明瞭な分岐では必ず立ち止まり、ルートを確認してから進むこと。'
  ]
};

// ---------- per-course build ----------

async function buildCourse(courseId, opts) {
  const meta = COURSE_META[courseId];
  if (!meta) throw new Error('No COURSE_META for ' + courseId);
  const rawPath = path.join(RAW_DIR, courseId + '.geojson');
  if (!fs.existsSync(rawPath)) {
    console.log(`- ${courseId}: raw geojson not found, skipping`);
    return;
  }
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const allCoords = raw.features[0].geometry.coordinates; // [[lon, lat], ...]

  // 1. Keep full geometry for accurate distance, sample only for elevation cost.
  const sampled = allCoords.map(([lon, lat]) => [lon, lat, null]);
  const stride = Math.max(1, Math.floor(sampled.length / opts.targetPoints));
  console.log(`  ${courseId}: keeping ${sampled.length} geometry pts, sampling elevation every ${stride}`);

  // 2. Fetch elevation at sampled indices (and always at endpoints), then interpolate.
  if (!opts.skipElevation) {
    const sampleIdx = [];
    for (let i = 0; i < sampled.length; i += stride) sampleIdx.push(i);
    if (sampleIdx[sampleIdx.length - 1] !== sampled.length - 1) sampleIdx.push(sampled.length - 1);
    let okCount = 0, failCount = 0;
    for (let k = 0; k < sampleIdx.length; k++) {
      const i = sampleIdx[k];
      const [lon, lat] = sampled[i];
      const ele = await fetchElevation(lat, lon);
      if (ele != null) { sampled[i][2] = ele; okCount++; } else failCount++;
      if ((k + 1) % 25 === 0) {
        process.stdout.write(`    elev ${k + 1}/${sampleIdx.length} (ok=${okCount}, fail=${failCount})\r`);
      }
      await sleep(GSI_DELAY_MS);
    }
    process.stdout.write('\n');
    console.log(`    elevations: ${okCount} fetched, ${failCount} failed`);

    // Linear-interpolate elevation at non-sampled indices using the nearest sampled neighbors.
    for (let i = 0; i < sampled.length; i++) {
      if (sampled[i][2] != null) continue;
      let prev = -1;
      for (let j = i - 1; j >= 0; j--) if (sampled[j][2] != null) { prev = j; break; }
      let next = -1;
      for (let j = i + 1; j < sampled.length; j++) if (sampled[j][2] != null) { next = j; break; }
      if (prev >= 0 && next >= 0) {
        const t = (i - prev) / (next - prev);
        sampled[i][2] = sampled[prev][2] + t * (sampled[next][2] - sampled[prev][2]);
      } else if (prev >= 0) sampled[i][2] = sampled[prev][2];
      else if (next >= 0) sampled[i][2] = sampled[next][2];
      else sampled[i][2] = 0;
    }
  } else {
    sampled.forEach(s => { s[2] = 0; });
  }

  // 3. Compute summary
  const distancesKm = [0];
  for (let i = 1; i < sampled.length; i++) {
    distancesKm.push(distancesKm[i - 1] + haversineKm(sampled[i - 1], sampled[i]));
  }
  const totalKm = Number(distancesKm[distancesKm.length - 1].toFixed(2));
  const { asc, desc } = cumulativeAscentDescent(sampled);
  const totalAscentM = Math.round(asc);
  const totalDescentM = Math.round(desc);
  const standardTimeHr = Number((totalKm * 0.40 + totalAscentM * 0.001).toFixed(2));
  const cc = 1.8 * standardTimeHr + 0.3 * totalKm + 10 * (totalAscentM / 1000) + 0.6 * (totalDescentM / 1000);
  const courseConstant = Number(cc.toFixed(1));

  const eles = sampled.map(s => s[2]).filter(e => isFinite(e));
  const highestM = eles.length ? Math.round(Math.max.apply(null, eles)) : 0;
  const lowestM = eles.length ? Math.round(Math.min.apply(null, eles)) : 0;

  const stdH = Math.floor(standardTimeHr);
  const stdM = Math.round((standardTimeHr - stdH) * 60);
  const standardTimeLabel = `${stdH}時間${stdM}分`;

  // 4. Checkpoints (auto from segment descriptions)
  const wpRaw = checkpointsFromSegments(raw.segments);
  const cpsPlaced = placeCheckpointsOnLine(wpRaw, raw.segments, sampled);
  const checkpoints = cpsPlaced.map((c, idx, arr) => {
    const isFirst = idx === 0;
    const isLast = idx === arr.length - 1;
    const distAtCp = distancesKm[c.coordIdx] || 0;
    return {
      id: 'cp-' + idx,
      types: inferCheckpointType(c.name, isFirst, isLast, distAtCp),
      name: c.name,
      distanceKm: Number(distAtCp.toFixed(2)),
      elevationM: Math.round(sampled[c.coordIdx][2] || 0),
      lat: Number(c.lat.toFixed(4)),
      lng: Number(c.lng.toFixed(4)),
      etaFromPrevLabel: null,
      description: '京都一周トレイル ' + meta.name + ' の標識付近。',
      tip: null
    };
  });

  // 5. Itinerary (from checkpoints + standard pace)
  const itinerary = checkpoints.map((cp, idx) => {
    const prev = idx > 0 ? checkpoints[idx - 1] : null;
    const segKm = prev ? Number((cp.distanceKm - prev.distanceKm).toFixed(2)) : null;
    return {
      time: '',                                  // intentionally blank: ユーザのスタート時刻に依存
      place: cp.name,
      isMajor: cp.types.includes('PEAK') || cp.types.includes('START') || cp.types.includes('GOAL'),
      elevationM: cp.elevationM,
      segmentKm: segKm,
      cumulativeKm: cp.distanceKm,
      action: cp.types.includes('START') ? '出発'
        : cp.types.includes('GOAL') ? '到着'
        : '通過'
    };
  });

  // 6. Segments table — derive per-segment ascent/descent from sampled elevations.
  // For each OSM segment, find the nearest sampled coords to its start/end and
  // compute the elevation delta along the slice.
  function nearestIndex(latlng) {
    let best = 0, bestKm = Infinity;
    for (let i = 0; i < sampled.length; i++) {
      const d = haversineKm([latlng[1], latlng[0]], [sampled[i][0], sampled[i][1]]);
      if (d < bestKm) { bestKm = d; best = i; }
    }
    return best;
  }
  function segmentAscentDescent(startIdx, endIdx) {
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    let asc = 0, desc = 0;
    for (let i = lo + 1; i <= hi; i++) {
      const dE = (sampled[i][2] || 0) - (sampled[i - 1][2] || 0);
      if (dE > 0) asc += dE; else desc += -dE;
    }
    return startIdx <= endIdx ? { asc, desc } : { asc: desc, desc: asc };
  }
  const segments = raw.segments.map(s => {
    const fromTo = parseFromTo(s.description);
    const distKm = s.distanceTag ? Number(s.distanceTag) : null;
    let ascentM = null, descentM = null, stdMinutes = null;
    if (s.startLatLng && s.endLatLng) {
      const si = nearestIndex(s.startLatLng);
      const ei = nearestIndex(s.endLatLng);
      const ad = segmentAscentDescent(si, ei);
      ascentM = Math.round(ad.asc);
      descentM = Math.round(ad.desc);
    }
    if (distKm != null) {
      // Naismith-flavored: 24 min/km flat + 1 min per 10m of net ascent
      stdMinutes = Math.round(distKm * 24 + (ascentM || 0) * 0.1);
    }
    return {
      from: fromTo.from || s.name,
      to: fromTo.to || '',
      distanceKm: distKm,
      deltaElevationM: ascentM != null && descentM != null ? ascentM - descentM : null,
      ascentM: ascentM,
      descentM: descentM,
      stdMinutes: stdMinutes,
      difficulty: 2,
      surface: '京都一周トレイル整備路'
    };
  });

  // 7. Peaks
  const peaks = findPeaks(sampled, distancesKm).slice(0, 8);

  // 8. Compose course JSON
  const course = {
    schemaVersion: 1,
    id: courseId,
    name: meta.name,
    subtitle: meta.subtitle,
    summary: {
      totalDistanceKm: totalKm,
      totalAscentM: totalAscentM,
      totalDescentM: totalDescentM,
      standardTimeHr: standardTimeHr,
      standardTimeLabel: standardTimeLabel,
      courseConstant: courseConstant,
      highestM: highestM,
      lowestM: lowestM,
      userBaseWeightKg: 60.0,
      gearWeightKg: 5.0
    },
    geometry: {
      type: 'LineString',
      coordinates: sampled.map(s => [Number(s[0].toFixed(5)), Number(s[1].toFixed(5)), Math.round(s[2] || 0)])
    },
    checkpoints: checkpoints,
    peaks: peaks,
    itinerary: itinerary,
    segments: segments,
    pace: {
      standardTimeLabel: standardTimeLabel,
      totalActionTimeLabel: `休憩込み目安 ${Math.round(standardTimeHr * 1.15)}時間`,
      splits: [],
      warnings: [
        '日没時刻を確認し、遅くとも日没1時間前にはゴールすること',
        '天候急変に備え、エスケープルートを事前に確認すること'
      ]
    },
    escapeRoutes: [],
    transit: { access: [], return: [] },
    toilets: [],
    toiletNote: 'コース上のトイレ情報は最新の京都一周トレイル公式マップを確認してください。',
    waterPoints: [],
    hazards: [
      { title: '夏季の熱中症', description: '直射日光下の市街地・林道区間で気温が上がる。早朝出発と十分な水分補給を。' },
      { title: '冬季の凍結・積雪', description: '稜線部・北向き斜面で凍結・積雪あり。チェーンスパイクを携行。' },
      { title: '長距離による疲労', description: 'コース定数 ' + courseConstant.toFixed(1) + ' は本コースを1日で完走する場合の難易度目安。無理せずエスケープルート・分割行を検討。' }
    ],
    wildlife: [
      { name: 'イノシシ', description: '京都市近郊の山域に生息。遭遇時は静かに後退。' },
      { name: 'マダニ', description: '春〜秋に活動。長袖長ズボン着用。下山後の全身チェック必須。' },
      { name: 'スズメバチ', description: '夏〜秋。黒い服・香水を避ける。巣に近づかない。' }
    ],
    marking: SHARED_MARKING,
    weatherCriteria: SHARED_WEATHER_CRITERIA,
    signal: {
      headers: ['docomo', 'au', 'SoftBank'],
      rows: [
        { section: '本コース全般', values: ['区間により不安定', '区間により不安定', '区間により不安定'] }
      ],
      warning: '稜線・峠付近は圏外になる区間あり。緊急時に備えオフライン地図も準備すること。'
    },
    emergency: {
      contacts: SHARED_EMERGENCY_CONTACTS.slice(),
      hospitals: [
        { label: '京都市内', name: '京都市急病診療所', tel: '075-354-6021', note: '夜間・休日（四条烏丸）' }
      ],
      rescueProcedure: SHARED_RESCUE_PROCEDURE.slice()
    },
    gear: SHARED_GEAR,
    _provenance: {
      source: 'OpenStreetMap (ODbL)',
      generator: 'tools/build_courses.js',
      osmRange: meta.osmRange,
      coverageNote: meta.osmCoverageNote,
      sourceRelations: raw.segments.map(s => s.relationId)
    }
  };

  const outPath = path.join(OUT_DIR, courseId + '.json');
  fs.writeFileSync(outPath, JSON.stringify(course, null, 2) + '\n');
  console.log(`  ✓ wrote ${path.relative(ROOT, outPath)}: ${totalKm}km / ${totalAscentM}m up / ${standardTimeLabel} / CC ${courseConstant.toFixed(1)} / ${checkpoints.length} CPs / ${peaks.length} peaks`);
}

async function main() {
  const args = parseArgs(process.argv);
  const courses = args.courses || ['higashiyama', 'kitayama-east', 'kitayama-west'];
  for (const c of courses) {
    if (c === 'nishiyama') {
      console.log(`- nishiyama: 既存の合成データを保持するため build をスキップ`);
      continue;
    }
    console.log(`Building ${c}...`);
    await buildCourse(c, args);
  }
  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = {
  parseFromTo, checkpointsFromSegments, cumulativeAscentDescent,
  totalDistanceKm, haversineKm, findPeaks
};
