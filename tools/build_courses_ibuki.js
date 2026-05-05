#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * tools/build_courses_ibuki.js (Phase 8)
 *
 * ibuki.run の CC0 GPX を入力にして、OSM データの欠落を埋める:
 *
 *   1. data/courses/raw/ibuki-keihoku.gpx
 *      → data/courses/keihoku.json をゼロから生成
 *        (OSM に hiking relation がない京北エリアの唯一の機械可読ソース)
 *
 *   2. data/courses/raw/ibuki-fullloop.gpx
 *      → data/courses/kitayama-west.json の OSM 未マップ区間 (marker 70-90,
 *        約 4km) を該当 ibuki 部分軌跡で splice、19.5km フルカバーに更新
 *
 * 標高は GSI getelevation API を使う (build_courses.js と同じ)。GSI が
 * 範囲外を返した場合のみ GPX に埋め込まれた GPS 標高を fallback として採用。
 *
 * Usage:
 *   node tools/build_courses_ibuki.js
 *   node tools/build_courses_ibuki.js --courses keihoku
 *   node tools/build_courses_ibuki.js --courses kitayama-west
 *   node tools/build_courses_ibuki.js --skip-elevation   # debug
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  haversineKm, cumulativeAscentDescent, findPeaks,
  fetchElevation, sleep, GSI_DELAY_MS,
  SHARED_GEAR, SHARED_EMERGENCY_CONTACTS, SHARED_RESCUE_PROCEDURE,
  SHARED_WEATHER_CRITERIA, SHARED_MARKING
} = require('./build_courses');

const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data/courses/raw');
const OUT_DIR = path.join(ROOT, 'data/courses');

const KEIHOKU_GPX = path.join(RAW_DIR, 'ibuki-keihoku.gpx');
const FULLLOOP_GPX = path.join(RAW_DIR, 'ibuki-fullloop.gpx');

// ---------- args ----------

function parseArgs(argv) {
  const args = { courses: ['keihoku', 'kitayama-west'], skipElevation: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--courses' && argv[i + 1]) args.courses = argv[++i].split(',');
    else if (argv[i] === '--skip-elevation') args.skipElevation = true;
    else if (argv[i] === '-h' || argv[i] === '--help') {
      console.log('see file header');
      process.exit(0);
    } else throw new Error('Unknown arg: ' + argv[i]);
  }
  return args;
}

// ---------- GPX parser ----------

/**
 * Tiny streaming-friendly regex parser. ibuki.run GPX uses the standard
 * GPX 1.1 schema with <trkpt lat lon><ele>VALUE</ele></trkpt>, but other
 * recorders may emit lon-before-lat or single-quote attributes — match the
 * tag first, then extract each attribute independently so we accept any
 * attribute order and either quote style.
 * Returns coords in [lon, lat, ele|null] order to match the rest of the pipeline.
 */
function parseGpxTrkpts(gpxContent) {
  const out = [];
  // Regex over the full file is acceptable: even the 1.2MB fullloop file is
  // ~17k matches and parses in <1s. We don't need a SAX parser at this scale.
  const tagRe = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  const latRe = /\blat=["']([\-\d.]+)["']/;
  const lonRe = /\blon=["']([\-\d.]+)["']/;
  const eleRe = /<ele>([\-\d.]+)<\/ele>/;
  let m;
  while ((m = tagRe.exec(gpxContent)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const latMatch = attrs.match(latRe);
    const lonMatch = attrs.match(lonRe);
    if (!latMatch || !lonMatch) continue;
    const lat = parseFloat(latMatch[1]);
    const lon = parseFloat(lonMatch[1]);
    const eleMatch = inner.match(eleRe);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      out.push([lon, lat, ele]);
    }
  }
  return out;
}

/**
 * Drop consecutive duplicate or near-duplicate points (< 1m apart) — ibuki
 * tracks often log multiple points at the start while waiting to begin moving.
 * Without this, the polyline has hundreds of zero-distance segments at the
 * head that bias the smoothed bounding box.
 */
function dedupCoords(coords, minSpacingMeters = 1.0) {
  if (coords.length < 2) return coords.slice();
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const prev = out[out.length - 1];
    const dKm = haversineKm(prev, coords[i]);
    if (dKm * 1000 >= minSpacingMeters) out.push(coords[i]);
  }
  return out;
}

/**
 * Pick a stride so the resulting array has ~targetPoints entries (preserving
 * first/last). Used to thin dense ibuki tracks to a reasonable density (~10m).
 */
function strideSample(coords, targetPoints) {
  if (coords.length <= targetPoints) return coords.slice();
  const stride = Math.max(2, Math.floor(coords.length / targetPoints));
  const out = [];
  for (let i = 0; i < coords.length; i += stride) out.push(coords[i]);
  if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]);
  return out;
}

// ---------- elevation pipeline ----------

/**
 * Sample elevation every Nth coord, falling back to the GPX's embedded GPS
 * elevation when GSI returns null (out of DEM coverage), then linear-interpolate
 * the gaps. Mutates coords in place; returns counts.
 */
async function fetchAndInterpolateElevations(coords, opts) {
  const targetSamples = Math.max(50, Math.min(200, Math.floor(coords.length / 10)));
  const stride = Math.max(1, Math.floor(coords.length / targetSamples));

  const sampleIdx = [];
  for (let i = 0; i < coords.length; i += stride) sampleIdx.push(i);
  if (sampleIdx[sampleIdx.length - 1] !== coords.length - 1) sampleIdx.push(coords.length - 1);

  // Stash the GPX-recorded elevation so non-sampled indices can still benefit
  // when GSI fails for a region.
  const gpsEle = coords.map(c => c[2]);
  // Reset all to null before fetching (we'll overwrite only sampled indices).
  for (const c of coords) c[2] = null;

  let okCount = 0, fallbackCount = 0, failCount = 0;
  if (!opts.skipElevation) {
    for (let k = 0; k < sampleIdx.length; k++) {
      const i = sampleIdx[k];
      const [lon, lat] = coords[i];
      const ele = await fetchElevation(lat, lon);
      if (ele != null) {
        coords[i][2] = ele;
        okCount++;
      } else if (Number.isFinite(gpsEle[i])) {
        coords[i][2] = gpsEle[i];
        fallbackCount++;
      } else {
        failCount++;
      }
      if ((k + 1) % 25 === 0) {
        process.stdout.write(
          `    elev ${k + 1}/${sampleIdx.length} (gsi=${okCount}, gpx=${fallbackCount}, none=${failCount})\r`
        );
      }
      await sleep(GSI_DELAY_MS);
    }
    process.stdout.write('\n');
    console.log(`    elevations: ${okCount} from GSI, ${fallbackCount} from GPX fallback, ${failCount} unresolved`);
  } else {
    // For --skip-elevation, just trust the GPX values (or 0).
    for (const i of sampleIdx) coords[i][2] = Number.isFinite(gpsEle[i]) ? gpsEle[i] : 0;
  }

  // Linear-interpolate non-sampled indices using nearest sampled neighbors.
  for (let i = 0; i < coords.length; i++) {
    if (coords[i][2] != null) continue;
    let prev = -1;
    for (let j = i - 1; j >= 0; j--) if (coords[j][2] != null) { prev = j; break; }
    let next = -1;
    for (let j = i + 1; j < coords.length; j++) if (coords[j][2] != null) { next = j; break; }
    if (prev >= 0 && next >= 0) {
      const t = (i - prev) / (next - prev);
      coords[i][2] = coords[prev][2] + t * (coords[next][2] - coords[prev][2]);
    } else if (prev >= 0) coords[i][2] = coords[prev][2];
    else if (next >= 0) coords[i][2] = coords[next][2];
    else coords[i][2] = Number.isFinite(gpsEle[i]) ? gpsEle[i] : 0;
  }

  return { okCount, fallbackCount, failCount };
}

// ---------- helpers shared across both course builds ----------

function computeCumulativeDistances(coords) {
  const distancesKm = [0];
  for (let i = 1; i < coords.length; i++) {
    distancesKm.push(distancesKm[i - 1] + haversineKm(coords[i - 1], coords[i]));
  }
  return distancesKm;
}

function summaryFor(coords, distancesKm) {
  const totalKm = Number(distancesKm[distancesKm.length - 1].toFixed(2));
  const { asc, desc } = cumulativeAscentDescent(coords);
  const totalAscentM = Math.round(asc);
  const totalDescentM = Math.round(desc);
  const standardTimeHr = Number((totalKm * 0.40 + totalAscentM * 0.001).toFixed(2));
  const cc = 1.8 * standardTimeHr + 0.3 * totalKm + 10 * (totalAscentM / 1000) + 0.6 * (totalDescentM / 1000);
  const courseConstant = Number(cc.toFixed(1));
  const eles = coords.map(c => c[2]).filter(e => Number.isFinite(e));
  const highestM = eles.length ? Math.round(Math.max.apply(null, eles)) : 0;
  const lowestM = eles.length ? Math.round(Math.min.apply(null, eles)) : 0;
  const stdH = Math.floor(standardTimeHr);
  const stdM = Math.round((standardTimeHr - stdH) * 60);
  const standardTimeLabel = `${stdH}時間${stdM}分`;
  return {
    totalDistanceKm: totalKm,
    totalAscentM, totalDescentM,
    standardTimeHr, standardTimeLabel, courseConstant,
    highestM, lowestM,
    userBaseWeightKg: 60.0, gearWeightKg: 5.0
  };
}

function nearestIndex(coords, target) {
  let best = 0, bestKm = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineKm(coords[i], target);
    if (d < bestKm) { bestKm = d; best = i; }
  }
  return { index: best, distKm: bestKm };
}

function compactGeometryForOutput(coords) {
  return coords.map(c => [
    Number(c[0].toFixed(5)),
    Number(c[1].toFixed(5)),
    Math.round(c[2] || 0)
  ]);
}

// ---------- keihoku full build ----------

const KEIHOKU_LANDMARKS = [
  // ibuki GPX (CC0) は公式案内図の細部とは少しズレる可能性があるため、
  // 起終点と「ジオメトリの形状から自明な要所」のみ landmark として扱う。
  // 中間 CP は距離マイルストーンで補い、ピークは findPeaks() に任せる
  // (これらは作為的でない、実標高ベースの真実)。
  { name: '京北コース 起点（高雄方面アプローチ）', useGpxStart: true, types: ['START'] },
  // 栃本峠は GPX に記録された最高点付近として推定 (lat≈35.19, lon≈135.66)
  { name: '栃本峠周辺（最高点）', target: [135.6601, 35.1916], types: ['PEAK'], maxOffsetKm: 1.0 },
  { name: '京北コース 終点（山国・周山方面）', useGpxEnd: true, types: ['GOAL'] }
];

const KEIHOKU_DISTANCE_MARKERS = [4, 8, 12, 16];

function buildKeihokuCheckpoints(coords, distancesKm) {
  const collected = [];
  // 1. 確定ランドマーク
  for (const lm of KEIHOKU_LANDMARKS) {
    let idx, accuracy = null;
    if (lm.useGpxStart) idx = 0;
    else if (lm.useGpxEnd) idx = coords.length - 1;
    else {
      const ni = nearestIndex(coords, lm.target);
      if (ni.distKm > (lm.maxOffsetKm || 1.0)) continue;
      idx = ni.index;
      accuracy = ni.distKm * 1000;
    }
    collected.push({ idx, types: lm.types, name: lm.name, accuracy });
  }
  // 2. 距離マイルストーン (既存ランドマークと近すぎる場合は省く)
  const totalKm = distancesKm[distancesKm.length - 1];
  for (const km of KEIHOKU_DISTANCE_MARKERS) {
    if (km >= totalKm - 0.5) continue;
    let idx = 0;
    for (let i = 0; i < distancesKm.length; i++) if (distancesKm[i] >= km) { idx = i; break; }
    const tooClose = collected.some(c => Math.abs(distancesKm[c.idx] - km) < 1.5);
    if (tooClose) continue;
    collected.push({
      idx,
      types: [],
      name: `${km}km 通過点`,
      accuracy: 0
    });
  }
  // 3. 整列して CP 生成
  collected.sort((a, b) => a.idx - b.idx);
  return collected.map((c, i) => ({
    id: 'cp-' + i,
    types: c.types,
    name: c.name,
    distanceKm: Number(distancesKm[c.idx].toFixed(2)),
    elevationM: Math.round(coords[c.idx][2] || 0),
    lat: Number(coords[c.idx][1].toFixed(4)),
    lng: Number(coords[c.idx][0].toFixed(4)),
    etaFromPrevLabel: null,
    description: c.types.includes('START') || c.types.includes('GOAL')
      ? '京都一周トレイル 京北コース。ibuki.run の GPX 軌跡 (CC0) を起終点とする推定座標です。実際の公式標識位置と数百 m〜数 km ずれる場合があります。'
      : c.types.includes('PEAK')
        ? '京北コース 最高点付近。ジオメトリ標高から自動推定。実際の栃本峠標識との位置関係は紙地図で要確認。'
        : '距離マイルストーン (ジオメトリ上の自動マーカー)。実標識ではありません。',
    tip: null
  }));
}

function buildKeihokuSegments(checkpoints, summary) {
  const segs = [];
  for (let i = 1; i < checkpoints.length; i++) {
    const prev = checkpoints[i - 1];
    const cur = checkpoints[i];
    const distKm = Number((cur.distanceKm - prev.distanceKm).toFixed(2));
    const ascentM = Math.max(0, cur.elevationM - prev.elevationM);
    const descentM = Math.max(0, prev.elevationM - cur.elevationM);
    const stdMinutes = Math.round(distKm * 24 + ascentM * 0.1);
    segs.push({
      from: prev.name, to: cur.name,
      distanceKm: distKm,
      deltaElevationM: cur.elevationM - prev.elevationM,
      ascentM, descentM, stdMinutes,
      difficulty: 2,
      surface: '山道（杉檜林・林道）'
    });
  }
  return segs;
}

async function buildKeihoku(opts) {
  console.log('Building keihoku from ibuki-keihoku.gpx ...');
  const gpx = fs.readFileSync(KEIHOKU_GPX, 'utf8');
  let coords = parseGpxTrkpts(gpx);
  console.log(`  parsed ${coords.length} trkpts`);
  coords = dedupCoords(coords, 1.0);
  console.log(`  ${coords.length} after 1m dedup`);
  // Thin to ~10m spacing for parity with OSM-derived courses (3000-pt scale).
  // 18.8 km / 10 m = 1880 target points.
  coords = strideSample(coords, 1900);
  console.log(`  ${coords.length} after stride sample (~10m spacing)`);

  await fetchAndInterpolateElevations(coords, opts);

  const distancesKm = computeCumulativeDistances(coords);
  const summary = summaryFor(coords, distancesKm);
  const checkpoints = buildKeihokuCheckpoints(coords, distancesKm);
  const segments = buildKeihokuSegments(checkpoints, summary);
  const peaks = findPeaks(coords, distancesKm).slice(0, 6);

  const itinerary = checkpoints.map((cp, idx) => {
    const prev = idx > 0 ? checkpoints[idx - 1] : null;
    const segKm = prev ? Number((cp.distanceKm - prev.distanceKm).toFixed(2)) : null;
    return {
      time: '',
      place: cp.name,
      isMajor: cp.types.includes('PEAK') || cp.types.includes('START') || cp.types.includes('GOAL'),
      elevationM: cp.elevationM,
      segmentKm: segKm,
      cumulativeKm: cp.distanceKm,
      action: cp.types.includes('START') ? '出発' : cp.types.includes('GOAL') ? '到着' : '通過'
    };
  });

  const course = {
    schemaVersion: 1,
    id: 'keihoku',
    name: '京北コース',
    subtitle: '京北エリア独立周回（高雄方面〜栃本峠〜山国・周山）',
    summary,
    geometry: {
      type: 'LineString',
      coordinates: compactGeometryForOutput(coords)
    },
    checkpoints,
    peaks,
    itinerary,
    segments,
    pace: {
      standardTimeLabel: summary.standardTimeLabel,
      totalActionTimeLabel: `休憩込み目安 ${Math.round(summary.standardTimeHr * 1.15)}時間`,
      splits: [],
      warnings: [
        '京北エリアは公共交通の本数が少ない。下山後のバス時刻表を必ず事前確認すること。',
        '杉檜林の倒木・路面荒れがある区間あり。雨天時は特に滑落注意。',
        '日没時刻を確認し、遅くとも日没1時間前には下山口に到着すること。'
      ]
    },
    // Schema: { atCheckpoint, atKm, description } (matches nishiyama renderer).
    // 京北は脱出路が極めて少ないため、距離マイルストーンに紐付けた概略のみ。
    escapeRoutes: [
      { atCheckpoint: '12km 通過点 (余野・細野方面)', atKm: 12.0, description: '集落へ下山し JR バス周山行に接続。バス本数は1日数本のため時刻表事前確認必須。' },
      { atCheckpoint: '栃本峠周辺（最高点）', atKm: 14.22, description: '林道経由で府道へ下山、徒歩で周山方面のバス停へ。所要 1 時間〜。' }
    ],
    // Schema: access[] = { from, route, duration, note? }, return[] = { from, route, note? }
    transit: {
      access: [
        { from: 'JR京都駅', route: 'JRバス 高雄・京北線「周山」行きで高雄下車', duration: '約60分', note: '本数少なめ。土日は事前要確認' }
      ],
      return: [
        { from: '周山バス停', route: 'JRバス 高雄・京北線で京都駅へ', note: '所要約95分。最終便は早めなので時刻表必須' }
      ]
    },
    toilets: [],
    toiletNote: '京北エリアはコース上のトイレが少ない。出発前と下山後に集落のトイレを使うこと。',
    waterPoints: [],
    hazards: [
      { title: '熊出没注意エリア', description: '京北一帯は熊の生息域。鈴・ラジオで存在を知らせる。早朝・夕方は特に警戒。' },
      { title: 'マダニ', description: '杉檜林の下草で多発。長袖長ズボン、下山後の全身チェック必須。' },
      { title: '林道倒木・路面荒れ', description: '台風・大雨後はルートが不明瞭になる区間あり。紙地図と GPS の併用必須。' },
      { title: '長距離 + アクセス困難', description: 'バス便が少ないため、計画ミスで日没後の徒歩下山となるリスクあり。' }
    ],
    wildlife: [
      { name: 'ツキノワグマ', description: '京北山域に生息。遭遇時は静かに後退。決して走らない。' },
      { name: 'イノシシ', description: '突進されると重傷。距離を取り刺激しない。' },
      { name: 'マダニ・ヤマビル', description: '湿った下草で多発。' },
      { name: 'スズメバチ', description: '夏〜秋。黒い服・香水を避ける。' }
    ],
    marking: SHARED_MARKING,
    weatherCriteria: SHARED_WEATHER_CRITERIA,
    signal: {
      headers: ['docomo', 'au', 'SoftBank'],
      rows: [
        { section: '京北本線・峠付近', values: ['区間により圏外', '区間により圏外', '区間により圏外'] }
      ],
      warning: '京北山域は携帯圏外区間が長い。衛星 GPS（地理院オフライン地図）と紙地図を必携。'
    },
    emergency: {
      contacts: SHARED_EMERGENCY_CONTACTS.slice(),
      hospitals: [
        { label: '京北エリア', name: '京都市立京北病院', tel: '075-852-0023', note: '京北周山町' }
      ],
      rescueProcedure: SHARED_RESCUE_PROCEDURE.slice()
    },
    gear: SHARED_GEAR,
    _provenance: {
      source: 'ibuki.run GPX (CC0 1.0 Universal)',
      sourceUrl: 'https://ibuki.run/c/8960902124485477537/',
      generator: 'tools/build_courses_ibuki.js',
      coverageNote: '京北コースは OpenStreetMap に hiking relation が存在しないため、ibuki.run の CC0 GPX (約18.8km) を唯一のジオメトリソースとして採用。標高は国土地理院 getelevation API でリサンプリング、欠測時は GPX 内蔵 GPS 標高で補完。',
      checkpointAccuracyNote: 'チェックポイント (起点・終点を除く) は概略座標から最近接点にスナップした推定位置で、実標識から数百 m 程度ずれる可能性があります。',
      licenseRef: 'data/courses/raw/CREDITS.md'
    }
  };

  const outPath = path.join(OUT_DIR, 'keihoku.json');
  fs.writeFileSync(outPath, JSON.stringify(course, null, 2) + '\n');
  console.log(`  ✓ wrote ${path.relative(ROOT, outPath)}: ${summary.totalDistanceKm}km / ${summary.totalAscentM}m up / ${summary.standardTimeLabel} / CC ${summary.courseConstant.toFixed(1)} / ${checkpoints.length} CPs`);
}

// ---------- kitayama-west gap fill ----------

const GAP_THRESHOLD_KM = 0.5; // anything > 500m between consecutive geom pts = gap

/**
 * Locate the largest inter-point jump in `coords`. Returns the index pair
 * (gapIdxBefore, gapIdxAfter) where gapIdxAfter = gapIdxBefore + 1.
 */
function findLargestGap(coords) {
  let maxKm = 0, idx = -1;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineKm(coords[i - 1], coords[i]);
    if (d > maxKm) { maxKm = d; idx = i; }
  }
  return { gapIdxBefore: idx - 1, gapIdxAfter: idx, gapKm: maxKm };
}

/**
 * Slice an ibuki track between the indices nearest to gapStartCoord and
 * gapEndCoord. Always returns the slice in the geometric order [start → end].
 */
function extractIbukiSegment(ibukiCoords, gapStartCoord, gapEndCoord) {
  const start = nearestIndex(ibukiCoords, gapStartCoord);
  const end = nearestIndex(ibukiCoords, gapEndCoord);
  if (start.distKm > 0.05 || end.distKm > 0.05) {
    throw new Error(
      `ibuki track does not approach the gap closely enough ` +
      `(start ${(start.distKm * 1000).toFixed(0)}m, end ${(end.distKm * 1000).toFixed(0)}m). ` +
      `Refusing to splice.`
    );
  }
  const lo = Math.min(start.index, end.index);
  const hi = Math.max(start.index, end.index);
  let slice = ibukiCoords.slice(lo, hi + 1);
  if (start.index > end.index) slice = slice.reverse();
  return { slice, startMatchM: start.distKm * 1000, endMatchM: end.distKm * 1000 };
}

async function fillKitayamaWestGap(opts) {
  const targetPath = path.join(OUT_DIR, 'kitayama-west.json');
  const course = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const oldCoords = course.geometry.coordinates.map(c => [c[0], c[1], c[2]]);
  console.log(`Filling kitayama-west gap (existing ${oldCoords.length} pts, ${course.summary.totalDistanceKm}km)...`);

  const { gapIdxBefore, gapIdxAfter, gapKm } = findLargestGap(oldCoords);
  if (gapKm < GAP_THRESHOLD_KM) {
    console.log(`  no gap > ${GAP_THRESHOLD_KM}km found (largest: ${(gapKm * 1000).toFixed(0)}m). Nothing to fill.`);
    return;
  }
  console.log(`  detected gap: ${(gapKm).toFixed(2)}km between idx ${gapIdxBefore} and ${gapIdxAfter}`);
  const gapStartCoord = oldCoords[gapIdxBefore];
  const gapEndCoord = oldCoords[gapIdxAfter];

  const gpx = fs.readFileSync(FULLLOOP_GPX, 'utf8');
  let ibukiCoords = parseGpxTrkpts(gpx);
  ibukiCoords = dedupCoords(ibukiCoords, 1.0);
  console.log(`  loaded ibuki fullloop: ${ibukiCoords.length} pts after dedup`);

  const { slice, startMatchM, endMatchM } = extractIbukiSegment(ibukiCoords, gapStartCoord, gapEndCoord);
  console.log(`  ibuki splice match: start ${startMatchM.toFixed(0)}m, end ${endMatchM.toFixed(0)}m, ${slice.length} raw pts`);

  // Thin the splice to ~10m spacing to match OSM density.
  const sliceKm = computeCumulativeDistances(slice).pop();
  const sliceTarget = Math.max(50, Math.round(sliceKm * 100));
  const sliceThin = strideSample(slice, sliceTarget);
  console.log(`  thinned splice: ${sliceThin.length} pts over ${sliceKm.toFixed(2)}km`);

  // Fetch elevation only for the new pts (existing OSM pts already have it).
  await fetchAndInterpolateElevations(sliceThin, opts);

  // Splice. The OSM endpoints (oldCoords[gapIdxBefore], oldCoords[gapIdxAfter])
  // sit only 6m / 1m from the corresponding ibuki splice endpoints — keeping
  // both sides would create a near-zero-length micro-segment at each seam.
  // Drop the OSM gap-boundary points and let sliceThin's endpoints carry the
  // join, so the merged polyline has no duplicate-position artifacts.
  const head = oldCoords.slice(0, gapIdxBefore);
  const tail = oldCoords.slice(gapIdxAfter + 1);
  const merged = head.concat(sliceThin, tail);
  console.log(`  merged: ${head.length} (head) + ${sliceThin.length} (ibuki) + ${tail.length} (tail) = ${merged.length} pts (OSM seam pts dropped)`);

  // Recompute distances + summary using the same formulas as build_courses.js.
  const distancesKm = computeCumulativeDistances(merged);
  const newSummary = summaryFor(merged, distancesKm);

  // Re-snap CPs to nearest index in the new geometry, preserving lat/lng.
  const cps = course.checkpoints.map((cp, idx, all) => {
    const target = [cp.lng, cp.lat, 0];
    const { index } = nearestIndex(merged, target);
    return Object.assign({}, cp, {
      distanceKm: Number(distancesKm[index].toFixed(2)),
      elevationM: Math.round(merged[index][2] || 0),
      _newIdx: index,
      _orderIdx: idx
    });
  });
  // Maintain monotonic CP ordering by distance (after the splice, the original
  // CP order should still be valid because the splice is purely interior).
  cps.sort((a, b) => a.distanceKm - b.distanceKm);
  cps.forEach((cp, i) => { cp.id = 'cp-' + i; delete cp._newIdx; delete cp._orderIdx; });

  // Recompute itinerary segment-distances from the updated CPs.
  const itinerary = cps.map((cp, idx) => {
    const prev = idx > 0 ? cps[idx - 1] : null;
    const segKm = prev ? Number((cp.distanceKm - prev.distanceKm).toFixed(2)) : null;
    return {
      time: '',
      place: cp.name,
      isMajor: cp.types.includes('PEAK') || cp.types.includes('START') || cp.types.includes('GOAL'),
      elevationM: cp.elevationM,
      segmentKm: segKm,
      cumulativeKm: cp.distanceKm,
      action: cp.types.includes('START') ? '出発' : cp.types.includes('GOAL') ? '到着' : '通過'
    };
  });

  // Recompute peaks against the merged geometry.
  const peaks = findPeaks(merged, distancesKm).slice(0, 8);

  // Update segments table: per-segment ascent/descent must be recomputed
  // because the gap is now actual climb/descent. We re-derive from CP order.
  const segments = course.segments.map((s, i) => {
    if (i >= cps.length - 1) return s;
    const prev = cps[i];
    const cur = cps[i + 1];
    const distKm = Number((cur.distanceKm - prev.distanceKm).toFixed(2));
    // Compute ascent/descent on the merged geometry between prev and cur.
    const startTarget = [prev.lng, prev.lat, 0];
    const endTarget = [cur.lng, cur.lat, 0];
    const si = nearestIndex(merged, startTarget).index;
    const ei = nearestIndex(merged, endTarget).index;
    const lo = Math.min(si, ei), hi = Math.max(si, ei);
    let asc = 0, desc = 0;
    for (let j = lo + 1; j <= hi; j++) {
      const dE = (merged[j][2] || 0) - (merged[j - 1][2] || 0);
      if (dE > 0) asc += dE; else desc += -dE;
    }
    const ascentM = Math.round(si <= ei ? asc : desc);
    const descentM = Math.round(si <= ei ? desc : asc);
    const stdMinutes = Math.round(distKm * 24 + ascentM * 0.1);
    return Object.assign({}, s, {
      distanceKm: distKm,
      deltaElevationM: ascentM - descentM,
      ascentM, descentM, stdMinutes
    });
  });

  // Compose updated course.
  course.summary = newSummary;
  course.geometry.coordinates = compactGeometryForOutput(merged);
  course.checkpoints = cps;
  course.peaks = peaks;
  course.itinerary = itinerary;
  course.segments = segments;
  course._provenance = Object.assign({}, course._provenance, {
    coverageNote: `OSM の marker 46-69, 91-94 セグメント + ibuki.run CC0 GPX で marker 70-90 (約 ${(gapKm).toFixed(1)}km) を補完。実走 GPS ベースで合計 ${newSummary.totalDistanceKm}km をフルカバー (公称 19.5km との差は ibuki ユーザーの実踏査ルートが公称より起伏のある経路を通過したことに起因)。`,
    gapFillSource: 'ibuki.run GPX (CC0 1.0 Universal)',
    gapFillUrl: 'https://ibuki.run/c/8961576220845321440/',
    gapFillNote: `OSM 未マップの marker 70-90 区間 (chord ${(gapKm).toFixed(1)}km) を ibuki.run GPS 軌跡 ${sliceThin.length} 点 で補完 (実走距離 ${(sliceThin.length > 0 ? computeCumulativeDistances(sliceThin).pop() : 0).toFixed(2)}km)。`,
    licenseRef: 'data/courses/raw/CREDITS.md'
  });

  fs.writeFileSync(targetPath, JSON.stringify(course, null, 2) + '\n');
  console.log(`  ✓ updated ${path.relative(ROOT, targetPath)}: ${newSummary.totalDistanceKm}km / ${newSummary.totalAscentM}m up / ${newSummary.standardTimeLabel} / CC ${newSummary.courseConstant.toFixed(1)} / ${cps.length} CPs`);
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv);
  for (const c of args.courses) {
    if (c === 'keihoku') await buildKeihoku(args);
    else if (c === 'kitayama-west') await fillKitayamaWestGap(args);
    else throw new Error(`Unknown course id for this builder: ${c}`);
  }
  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = {
  parseGpxTrkpts, dedupCoords, strideSample,
  computeCumulativeDistances, summaryFor, nearestIndex,
  findLargestGap, extractIbukiSegment
};
