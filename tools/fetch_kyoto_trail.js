#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * tools/fetch_kyoto_trail.js
 *
 * 京都一周トレイルの全ルートを OpenStreetMap (Overpass API) から取得し、
 * コース別 (higashiyama / kitayama-east / kitayama-west / nishiyama / keihoku)
 * に LineString GeoJSON を組み立てて data/courses/raw/ に出力する。
 *
 * - 認証情報なし、純 HTTPS。Node 12+ で動作するよう built-in https を使用。
 * - 出力データの再配布は OpenStreetMap の ODbL ライセンス準拠で出典明記が必要。
 *
 * Usage:
 *   node tools/fetch_kyoto_trail.js
 *   node tools/fetch_kyoto_trail.js --bbox 34.85,135.50,35.40,135.95
 *   node tools/fetch_kyoto_trail.js --courses higashiyama,nishiyama
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data/courses/raw');

// 京都一周トレイル本線 + 京北エリアを覆う bounding box (lat_min, lon_min, lat_max, lon_max)
const DEFAULT_BBOX = [34.85, 135.50, 35.40, 135.95];

// Overpass エンドポイント候補 (順に試行)
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// ---------- Argument parsing ----------

function parseArgs(argv) {
  const args = { bbox: DEFAULT_BBOX, courses: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--bbox' && argv[i + 1]) {
      args.bbox = argv[++i].split(',').map(Number);
      if (args.bbox.length !== 4 || args.bbox.some(n => !isFinite(n))) {
        throw new Error('--bbox は lat_min,lon_min,lat_max,lon_max');
      }
    } else if (argv[i] === '--courses' && argv[i + 1]) {
      args.courses = argv[++i].split(',').map(s => s.trim());
    } else if (argv[i] === '-h' || argv[i] === '--help') {
      console.log('Usage: node tools/fetch_kyoto_trail.js [--bbox lat_min,lon_min,lat_max,lon_max] [--courses higashiyama,...]');
      process.exit(0);
    } else {
      throw new Error('Unknown arg: ' + argv[i]);
    }
  }
  return args;
}

// ---------- HTTP ----------

function httpRequest(method, urlStr, opts) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const reqOpts = {
      method: method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: Object.assign({
        'User-Agent': 'kyototrailplan05/0.1 (https://github.com/Funmatu/kyototrailplan05)'
      }, (opts && opts.headers) || {})
    };
    const req = https.request(reqOpts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode + ' ' + (data.slice(0, 300) || '')));
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    if (opts && opts.body) req.write(opts.body);
    req.end();
  });
}

async function overpassQuery(query) {
  const body = 'data=' + encodeURIComponent(query);
  let lastErr;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const t0 = Date.now();
      const res = await httpRequest('POST', ep, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      });
      console.log(`  ✓ ${ep} (${Date.now() - t0}ms, ${res.length} bytes)`);
      return JSON.parse(res);
    } catch (e) {
      console.warn(`  × ${ep}: ${e.message.slice(0, 120)}`);
      lastErr = e;
    }
  }
  throw new Error('All Overpass endpoints failed. Last: ' + lastErr.message);
}

// ---------- Course classification ----------

/**
 * Overpass relation の name から所属コース ID と marker の数値順を判定する。
 * 例:
 *   "京都一周トレイル東山コース F1:F6"     → { course: 'higashiyama', markerKey: [-99, 1, 6] }
 *   "京都一周トレイル東山コース 21:30-2"   → { course: 'higashiyama', markerKey: [0, 21, 30.5] }
 *   "京都一周トレイル北山コース 1:7"       → { course: 'kitayama-east' or 'kitayama-west', based on marker }
 *   "京都一周トレイル西山コース 1:5-2"     → { course: 'nishiyama', markerKey: [0, 1, 5.4] }
 *   "京都一周トレイル北山コース 90:94 西山コース 1" → 連結区間 (清滝〜苔寺) 西山に分類
 */
const COURSE_NAMES = ['higashiyama', 'kitayama-east', 'kitayama-west', 'nishiyama', 'keihoku'];

// 北山コースは marker 1〜46 が東部、46〜70 (+) が西部 (二ノ瀬以西)
const KITAYAMA_EAST_MAX_MARKER = 46;

function parseMarker(token) {
  // "F1" / "F30-2" / "21" / "30-2" / "5-2"
  const m = token.match(/^F?(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const major = parseInt(m[1], 10);
  const minor = m[2] ? parseInt(m[2], 10) : 0;
  return major + minor / 10;
}

function classifyRelation(rel) {
  const name = rel.tags && (rel.tags['name'] || rel.tags['name:en'] || '');
  const desc = rel.tags && rel.tags.description || '';

  // Special: composite "北山コース 90:94 西山コース 1" — markers 90+ are the western
  // end of the 北山西部 course (高雄橋から清滝). Classify into kitayama-west so the
  // connector contributes to that course's continuous geometry.
  if (/西山コース/.test(name) && /北山コース/.test(name)) {
    return { course: 'kitayama-west', markerKey: [0, 90, 0], note: 'connector' };
  }

  // 京北 (sometimes tagged 京北コース or 京北トレイル)
  if (/京北/.test(name)) {
    const m = name.match(/(\d+)(?:-(\d+))?:(\d+)(?:-(\d+))?/);
    if (m) {
      return { course: 'keihoku', markerKey: [0, parseInt(m[1], 10) + (parseInt(m[2] || 0, 10) / 10), 0] };
    }
    return { course: 'keihoku', markerKey: [9999, 0, 0] };
  }

  // 西山コース
  if (/西山コース/.test(name)) {
    const m = name.match(/(\d+)(?:-(\d+))?:(\d+)(?:-(\d+))?/);
    if (m) {
      const startMarker = parseInt(m[1], 10) + (parseInt(m[2] || 0, 10) / 10);
      return { course: 'nishiyama', markerKey: [0, startMarker, 0] };
    }
    return { course: 'nishiyama', markerKey: [9999, 0, 0] };
  }

  // 東山コース
  if (/東山コース/.test(name)) {
    // F1-F35 (伏見桃山-稲荷) を [-1, ...], 数字のみ (稲荷以降) を [0, ...] でソート
    const fMatch = name.match(/F(\d+)(?:-(\d+))?:F?(\d+)(?:-(\d+))?/);
    if (fMatch) {
      const startMarker = parseInt(fMatch[1], 10) + (parseInt(fMatch[2] || 0, 10) / 10);
      return { course: 'higashiyama', markerKey: [-1, startMarker, 0] };
    }
    const nMatch = name.match(/(\d+)(?:-(\d+))?:(\d+)(?:-(\d+))?/);
    if (nMatch) {
      const startMarker = parseInt(nMatch[1], 10) + (parseInt(nMatch[2] || 0, 10) / 10);
      return { course: 'higashiyama', markerKey: [0, startMarker, 0] };
    }
    return { course: 'higashiyama', markerKey: [9999, 0, 0] };
  }

  // 北山コース → marker 番号で東部/西部を判別
  if (/北山コース/.test(name)) {
    const nMatch = name.match(/(\d+)(?:-(\d+))?:(\d+)(?:-(\d+))?/);
    if (nMatch) {
      const startMarker = parseInt(nMatch[1], 10) + (parseInt(nMatch[2] || 0, 10) / 10);
      const course = startMarker < KITAYAMA_EAST_MAX_MARKER ? 'kitayama-east' : 'kitayama-west';
      return { course: course, markerKey: [0, startMarker, 0] };
    }
    return { course: 'kitayama-east', markerKey: [9999, 0, 0] };
  }

  return { course: null, markerKey: [Infinity, 0, 0] };
}

function compareMarkerKey(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// ---------- Geometry assembly ----------

function buildNodeIndex(elements) {
  const index = new Map();
  for (const el of elements) {
    if (el.type === 'node') {
      index.set(el.id, [el.lon, el.lat]);
    }
  }
  return index;
}

function buildWayIndex(elements) {
  const index = new Map();
  for (const el of elements) {
    if (el.type === 'way') {
      index.set(el.id, el.nodes);
    }
  }
  return index;
}

/**
 * Stitch the member ways of a relation into a single ordered coordinate sequence.
 * Tries to match endpoints of consecutive ways to recover traversal direction even
 * when role tags are missing. Returns coords as [[lon, lat], ...].
 */
function stitchWays(rel, wayIndex, nodeIndex) {
  const wayMembers = (rel.members || []).filter(m => m.type === 'way' && wayIndex.has(m.ref));
  if (!wayMembers.length) return [];

  const ways = wayMembers.map(m => {
    const nodes = wayIndex.get(m.ref) || [];
    return { ref: m.ref, nodes: nodes.slice() };
  });

  // Greedy chaining: start with first way as-is, then for each subsequent way, attach
  // by matching its endpoint to the running tail; flip if needed.
  if (!ways[0].nodes.length) return [];
  const out = ways[0].nodes.slice();
  for (let i = 1; i < ways.length; i++) {
    const w = ways[i].nodes;
    if (!w.length) continue;
    const tail = out[out.length - 1];
    if (w[0] === tail) {
      out.push.apply(out, w.slice(1));
    } else if (w[w.length - 1] === tail) {
      out.push.apply(out, w.slice(0, -1).reverse());
    } else if (w[0] === out[0]) {
      // The starter way was reversed; flip out
      out.reverse();
      out.push.apply(out, w.slice(1));
    } else if (w[w.length - 1] === out[0]) {
      out.reverse();
      out.push.apply(out, w.slice(0, -1).reverse());
    } else {
      // Disconnected segment — append with a small gap (rare; usually means underlying OSM data is broken)
      out.push.apply(out, w);
    }
  }
  // Map node ids to coordinates
  const coords = [];
  for (const id of out) {
    const c = nodeIndex.get(id);
    if (c) coords.push(c);
  }
  return coords;
}

function concatLineStrings(coordSeqs) {
  // Concatenate per-relation coordinate sequences, dropping duplicate joiners.
  const out = [];
  for (const seq of coordSeqs) {
    if (!seq.length) continue;
    if (!out.length) {
      out.push.apply(out, seq);
      continue;
    }
    const last = out[out.length - 1];
    const seqHead = seq[0];
    const seqTail = seq[seq.length - 1];
    // Pick endpoint orientation that minimizes the gap
    const dHead = haversineKm(last, seqHead);
    const dTail = haversineKm(last, seqTail);
    if (dTail < dHead) {
      // reverse seq
      for (let i = seq.length - 1; i >= 0; i--) out.push(seq[i]);
    } else {
      out.push.apply(out, seq);
    }
  }
  // Dedup consecutive duplicates
  const dedup = [];
  for (const c of out) {
    const prev = dedup[dedup.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) dedup.push(c);
  }
  return dedup;
}

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

// ---------- Main ----------

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const [latMin, lonMin, latMax, lonMax] = args.bbox;
  const query = `
[out:json][timeout:120];
(
  rel["route"="hiking"]["name"~"京都一周トレイル"](${latMin},${lonMin},${latMax},${lonMax});
  rel["route"="hiking"]["name"~"京都一周.*京北"](${latMin},${lonMin},${latMax},${lonMax});
);
out body;
>>;
out skel qt;`.trim();

  console.log('Fetching Overpass:');
  const data = await overpassQuery(query);

  const elements = data.elements || [];
  const relations = elements.filter(e => e.type === 'relation');
  const nodeIndex = buildNodeIndex(elements);
  const wayIndex = buildWayIndex(elements);
  console.log(`Found ${relations.length} relations / ${nodeIndex.size} nodes / ${wayIndex.size} ways`);

  const buckets = {};
  COURSE_NAMES.forEach(c => { buckets[c] = []; });
  let unclassified = 0;

  for (const rel of relations) {
    const cls = classifyRelation(rel);
    if (!cls.course || (args.courses && !args.courses.includes(cls.course))) {
      if (!cls.course) unclassified++;
      continue;
    }
    const coords = stitchWays(rel, wayIndex, nodeIndex);
    if (!coords.length) continue;
    buckets[cls.course].push({
      relId: rel.id,
      name: rel.tags.name,
      description: rel.tags.description || '',
      distanceTag: rel.tags.distance || null,
      markerKey: cls.markerKey,
      coords: coords
    });
  }

  if (unclassified) console.log(`(skipped ${unclassified} relations not matching any course)`);

  for (const courseId of COURSE_NAMES) {
    const segs = buckets[courseId];
    if (!segs.length) {
      console.log(`- ${courseId}: 0 segments (skipping)`);
      continue;
    }
    segs.sort((a, b) => compareMarkerKey(a.markerKey, b.markerKey));
    const concatenated = concatLineStrings(segs.map(s => s.coords));
    const dist = totalDistanceKm(concatenated);

    const out = {
      type: 'FeatureCollection',
      generator: 'tools/fetch_kyoto_trail.js',
      attribution: '© OpenStreetMap contributors (ODbL)',
      courseId: courseId,
      computedDistanceKm: Number(dist.toFixed(3)),
      segments: segs.map(s => ({
        relationId: s.relId,
        name: s.name,
        description: s.description,
        distanceTag: s.distanceTag,
        markerKey: s.markerKey,
        pointCount: s.coords.length,
        startLatLng: s.coords[0] ? [s.coords[0][1], s.coords[0][0]] : null,
        endLatLng: s.coords.length ? [s.coords[s.coords.length - 1][1], s.coords[s.coords.length - 1][0]] : null
      })),
      features: [{
        type: 'Feature',
        properties: { courseId: courseId, totalDistanceKm: Number(dist.toFixed(3)) },
        geometry: { type: 'LineString', coordinates: concatenated.map(c => [c[0], c[1]]) }
      }]
    };
    const outPath = path.join(RAW_DIR, `${courseId}.geojson`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
    console.log(`+ ${courseId}: ${segs.length} segs / ${concatenated.length} points / ${dist.toFixed(2)} km → ${path.relative(ROOT, outPath)}`);
  }

  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { classifyRelation, compareMarkerKey, parseMarker, stitchWays, concatLineStrings, totalDistanceKm };
