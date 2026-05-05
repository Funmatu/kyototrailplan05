/* Kyoto Trail Plan — In-app GPS simulator (Phase 4)
 *
 * `navigator.geolocation` を上書きし、URL クエリで指定したコースのジオメトリ
 * を辿るフェイク GPS フィードを供給する。京都に行かずに全コース・全機能を
 * 検証するためのテスト基盤。
 *
 * Modes:
 *   1. Pure sim    `?sim=<courseId>&speed=N`        — Turf.along で polyline を倍速再生
 *   2. Shadow      `?sim=<courseId>&shadow=1`        — 実 GPS を取得し、コース起点に
 *                                                       平行移動して投影 (Phase 7 用、
 *                                                       自宅近所で実機 AGPS / Wake Lock
 *                                                       検証する用途)
 *
 * Optional params:
 *   start=<km>      開始距離オフセット (途中再開のテスト用)
 *   interval=<ms>   tick 間隔 (default 1000)
 *   jitter=<m>      ±ノイズ (default 10m, 0 で完全に経路上を進む)
 *
 * 仕様:
 *   - 既存の navigator.geolocation 実装を _origGeo に保持し、Object.defineProperty
 *     で navigator.geolocation を差し替える。Simulator.stop() で復元。
 *   - watchPosition / clearWatch / getCurrentPosition すべて互換実装。
 *   - tick ごとに Turf.along で polyline 上の指定距離点を計算し、ジッター付き
 *     GeolocationPosition オブジェクトを success コールバックに渡す。
 *   - 京都一周トレイル本線は実距離 84km 程度なので speed=10 でも 8 時間程度かかる。
 *     より速い検証には speed=20 〜 50 を推奨。
 */
(function () {
  'use strict';

  const HIKE_PACE_KMH = 2.2;        // baseline pace; multiplied by `speed`
  const DEFAULT_INTERVAL_MS = 1000;
  const DEFAULT_JITTER_M = 10;

  let _state = null;

  function parseUrlParams(qs) {
    const search = qs != null ? qs : location.search;
    const out = {};
    new URLSearchParams(search).forEach(function (v, k) { out[k] = v; });
    return out;
  }

  function detectMode() {
    const p = parseUrlParams();
    if (!p.sim) return null;
    return {
      courseId: p.sim,
      speed: Math.max(0.1, Math.min(200, Number(p.speed) || 10)),
      shadow: p.shadow === '1' || p.shadow === 'true',
      startKm: Math.max(0, Number(p.start) || 0),
      intervalMs: Math.max(100, Number(p.interval) || DEFAULT_INTERVAL_MS),
      jitterM: p.jitter === undefined ? DEFAULT_JITTER_M : Math.max(0, Number(p.jitter))
    };
  }

  function metersToDegLat(m) { return m / 111320; }
  function metersToDegLng(m, lat) {
    return m / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  }

  function withJitter(lat, lng, jitterM) {
    if (!jitterM) return { lat: lat, lng: lng };
    const r = Math.random;
    const dLat = (r() - 0.5) * 2 * metersToDegLat(jitterM);
    const dLng = (r() - 0.5) * 2 * metersToDegLng(jitterM, lat);
    return { lat: lat + dLat, lng: lng + dLng };
  }

  function buildPosition(lat, lng, accuracyM, speedMs, headingDeg) {
    return {
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy: accuracyM,
        altitude: null,
        altitudeAccuracy: null,
        heading: headingDeg != null ? headingDeg : null,
        speed: speedMs != null ? speedMs : null
      },
      timestamp: Date.now()
    };
  }

  function bearingDeg(a, b) {
    const φ1 = a[1] * Math.PI / 180, φ2 = b[1] * Math.PI / 180;
    const Δλ = (b[0] - a[0]) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // ------- Pure sim -------

  function startPureSim(course, mode) {
    if (typeof turf === 'undefined') throw new Error('Simulator requires turf.js');
    const line = turf.lineString(course.geometry.coordinates);
    const totalKm = (course.summary && course.summary.totalDistanceKm) || 0;
    // Use time-based stride (Date.now() delta per tick) instead of nominal
    // mode.intervalMs so a slow event loop doesn't drift simulated distance
    // away from real elapsed time.
    const _state = {
      mode: 'sim',
      course: course,
      modeOpts: mode,
      line: line,
      distanceKm: mode.startKm,
      totalKm: totalKm,
      watchers: new Map(),    // watchId → { success, error }
      nextWatchId: 1,
      timerId: null,
      lastTickAt: 0,
      lastPos: null
    };

    function buildCurrentPosition() {
      const dist = Math.min(_state.distanceKm, _state.totalKm);
      const pt = turf.along(_state.line, dist, { units: 'kilometers' });
      const [lng, lat] = pt.geometry.coordinates;
      const j = withJitter(lat, lng, mode.jitterM);
      const heading = _state.lastPos ? bearingDeg([_state.lastPos.lng, _state.lastPos.lat], [j.lng, j.lat]) : null;
      const speedMs = mode.speed * HIKE_PACE_KMH / 3.6;
      _state.lastPos = j;
      return buildPosition(j.lat, j.lng, 5, speedMs, heading);
    }

    function tick() {
      const now = Date.now();
      const elapsedMs = _state.lastTickAt ? (now - _state.lastTickAt) : mode.intervalMs;
      _state.lastTickAt = now;
      const strideKm = mode.speed * HIKE_PACE_KMH * (elapsedMs / 3600000);
      _state.distanceKm += strideKm;
      const reached = _state.distanceKm >= _state.totalKm;
      const pos = buildCurrentPosition();
      _state.watchers.forEach(function (w) {
        try { w.success(pos); } catch (_) { /* ignore listener errors */ }
      });
      if (reached && _state.timerId) {
        clearInterval(_state.timerId);
        _state.timerId = null;
      }
    }

    function ensureTimer() {
      if (_state.timerId || _state.watchers.size === 0) return;
      _state.lastTickAt = Date.now();
      // Fire an immediate fix so the app can begin rendering
      setTimeout(tick, 50);
      _state.timerId = setInterval(tick, mode.intervalMs);
    }

    return {
      _state: _state,
      api: {
        watchPosition: function (success, error /*, opts */) {
          const id = _state.nextWatchId++;
          _state.watchers.set(id, { success: success, error: error });
          ensureTimer();
          return id;
        },
        clearWatch: function (id) {
          if (id != null) _state.watchers.delete(id);
          if (_state.watchers.size === 0 && _state.timerId) {
            clearInterval(_state.timerId);
            _state.timerId = null;
            _state.lastTickAt = 0;
          }
        },
        getCurrentPosition: function (success, error /*, opts */) {
          try { success(buildCurrentPosition()); }
          catch (e) { if (error) error({ code: 2, message: 'simulator: ' + e.message }); }
        }
      }
    };
  }

  // ------- Shadow mode -------
  // 実 GPS を取得し、最初の fix を origin として記録、以降は origin からの差分を
  // course の起点座標に加算して投影する。経路に沿うよう座標をローテートしないので
  // 軌跡が経路に重なるとは限らないが、AGPS / Wake Lock / バッテリ消費の確認用には
  // 十分。実 GPS イベントの実行回数や精度をそのまま検証できる。

  function startShadow(course, mode, origGeo) {
    if (!origGeo) throw new Error('Shadow mode needs the original navigator.geolocation');
    const startCoord = course.geometry.coordinates[0]; // [lng, lat, ele]
    // Multi-watcher state. realOrigin is shared across watchers so concurrent
    // listeners see a consistent translated position.
    const _state = {
      mode: 'shadow',
      course: course,
      modeOpts: mode,
      realOrigin: null,
      lastPos: null,
      watchers: new Map(),    // simulatorWatchId → { realWatchId, success, error }
      nextWatchId: 1
    };

    function translate(realPos) {
      if (!_state.realOrigin) {
        _state.realOrigin = { lat: realPos.coords.latitude, lng: realPos.coords.longitude };
      }
      const dLat = realPos.coords.latitude - _state.realOrigin.lat;
      const dLng = realPos.coords.longitude - _state.realOrigin.lng;
      const lat = startCoord[1] + dLat;
      const lng = startCoord[0] + dLng;
      const heading = _state.lastPos
        ? bearingDeg([_state.lastPos.lng, _state.lastPos.lat], [lng, lat])
        : null;
      _state.lastPos = { lat: lat, lng: lng };
      return buildPosition(lat, lng, realPos.coords.accuracy, realPos.coords.speed, heading);
    }

    return {
      _state: _state,
      api: {
        watchPosition: function (success, error, opts) {
          const id = _state.nextWatchId++;
          const realId = origGeo.watchPosition(function (realPos) {
            try { success(translate(realPos)); }
            catch (e) { if (error) error({ code: 2, message: 'shadow: ' + e.message }); }
          }, error, opts);
          _state.watchers.set(id, { realWatchId: realId, success: success, error: error });
          return id;
        },
        clearWatch: function (id) {
          if (id == null) return;
          const entry = _state.watchers.get(id);
          if (!entry) return;
          origGeo.clearWatch(entry.realWatchId);
          _state.watchers.delete(id);
        },
        getCurrentPosition: function (success, error, opts) {
          origGeo.getCurrentPosition(function (realPos) {
            try { success(translate(realPos)); }
            catch (e) { if (error) error({ code: 2, message: 'shadow: ' + e.message }); }
          }, error, opts);
        }
      }
    };
  }

  // ------- Public API -------

  function start(course, mode) {
    if (_state && _state.active) stop();
    if (!course || !course.geometry || !course.geometry.coordinates || course.geometry.coordinates.length < 2) {
      throw new Error('Simulator: course geometry missing or too short');
    }
    const origGeo = navigator.geolocation;
    const impl = mode.shadow ? startShadow(course, mode, origGeo) : startPureSim(course, mode);
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: impl.api
    });
    _state = {
      active: true,
      mode: mode.shadow ? 'shadow' : 'sim',
      modeOpts: mode,
      origGeo: origGeo,
      impl: impl
    };
    return _state;
  }

  function stop() {
    if (!_state || !_state.active) return;
    // Tear down every active watcher: collect the IDs first so iteration is
    // not affected by clearWatch's mutation of the underlying Map.
    try {
      const inner = _state.impl._state;
      if (inner && inner.watchers) {
        Array.from(inner.watchers.keys()).forEach(function (id) {
          _state.impl.api.clearWatch(id);
        });
      }
    } catch (e) { /* ignore */ }
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: _state.origGeo
    });
    _state.active = false;
    _state = null;
  }

  function isActive() { return !!(_state && _state.active); }
  function getMode() { return _state ? _state.mode : null; }
  function getModeOpts() { return _state ? Object.assign({}, _state.modeOpts) : null; }

  window.Simulator = {
    detectMode: detectMode,
    start: start,
    stop: stop,
    isActive: isActive,
    getMode: getMode,
    getModeOpts: getModeOpts,
    // Internal — for tests
    _withJitter: withJitter,
    _bearingDeg: bearingDeg,
    _parseUrlParams: parseUrlParams
  };
})();
