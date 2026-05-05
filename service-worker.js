/* Kyoto Trail Plan — Service Worker (Phase 5)
 *
 * オフライン起動を可能にする最小限の PWA。アプリシェル + 全コース JSON +
 * CDN ライブラリをインストール時にプリキャッシュし、ランタイムでは:
 *   - GSI 国土地理院タイル: stale-while-revalidate (実質オフライン地図)
 *   - Open-Meteo / その他 API: network-first + cache fallback
 *   - それ以外: cache-first → network → fallback to /index.html (SPA shell)
 *
 * バージョン番号は変更ごとに上げる。activate でキャッシュを掃除する。
 */

'use strict';

const VERSION = 'ktp-shell-v1';
const RUNTIME_TILES = 'ktp-gsi-tiles';
const RUNTIME_API = 'ktp-api';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './js/progressStore.js',
  './js/weather.js',
  './js/simulator.js',
  './data/courses/index.json',
  './data/courses/higashiyama.json',
  './data/courses/kitayama-east.json',
  './data/courses/kitayama-west.json',
  './data/courses/nishiyama.json',
  './route_data.json'
];

const CDN_DEPS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // App shell (same-origin) — failure aborts install.
      const shellPromise = cache.addAll(APP_SHELL);
      // CDN deps (cross-origin) — best-effort. Don't fail install if a CDN
      // hiccups; the runtime fetch will retry.
      const cdnPromise = Promise.all(CDN_DEPS.map(function (u) {
        return cache.add(new Request(u, { mode: 'no-cors' })).catch(function () {});
      }));
      return Promise.all([shellPromise, cdnPromise]);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  const keep = [VERSION, RUNTIME_TILES, RUNTIME_API];
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (keep.indexOf(k) === -1) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isGsiTile(url) {
  return url.hostname === 'cyberjapandata.gsi.go.jp' && /\/xyz\//.test(url.pathname);
}
function isOpenMeteo(url) {
  return /(^|\.)open-meteo\.com$/.test(url.hostname);
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone()).catch(function () {});
    }
    return res;
  }).catch(function () { return null; });
  // Return cached immediately when available; otherwise wait on the network.
  return cached || fetchPromise || new Response('offline', { status: 503 });
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || new Response('offline', { status: 503 });
  }
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Skip cross-origin chrome-extension etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isGsiTile(url)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_TILES));
    return;
  }
  if (isOpenMeteo(url)) {
    event.respondWith(networkFirst(req, RUNTIME_API));
    return;
  }

  // Same-origin (or precached CDN): cache-first, fallback to network, fallback to shell index for navigations.
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).catch(function () {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('offline', { status: 503 });
      });
    })
  );
});
