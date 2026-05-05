/* Kyoto Trail Plan — Weather forecast (Open-Meteo)
 *
 * 起動時に当日の天気予報を一度だけ取得して、ランディングおよびコースビュー
 * の補足情報タブに表示する。Open-Meteo API は無料・APIキー不要・CORS 有効
 * なので GitHub Pages から直接 fetch できる。
 *
 * - 取得失敗 / オフライン時は静かに無表示で degrade
 * - 同一日の再起動では localStorage キャッシュを優先 (再フェッチ最大 4 回/日)
 * - 京都市内は ~30 km radius なので、緯度経度を 0.01 単位で丸めた key を共有
 */
(function () {
  'use strict';

  const CACHE_PREFIX = 'ktp.weather.';
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const TIMEOUT_MS = 8000;
  const API_URL = 'https://api.open-meteo.com/v1/forecast';

  function todayDateStr(d) {
    const dt = d || new Date();
    const tz = 9 * 60;
    const local = new Date(dt.getTime() + (tz - dt.getTimezoneOffset()) * 60000);
    return local.toISOString().slice(0, 10); // YYYY-MM-DD in JST
  }

  function cacheKey(date, lat, lng) {
    return CACHE_PREFIX + date + '.' + Number(lat).toFixed(2) + '.' + Number(lng).toFixed(2);
  }

  function buildUrl(lat, lng) {
    const params = [
      'latitude=' + lat,
      'longitude=' + lng,
      'daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset,weather_code',
      'timezone=Asia%2FTokyo',
      'forecast_days=1'
    ];
    return API_URL + '?' + params.join('&');
  }

  function parseOpenMeteo(json) {
    const d = (json && json.daily) || {};
    const at = arr => Array.isArray(arr) ? arr[0] : null;
    return {
      date: at(d.time),
      tempMaxC: at(d.temperature_2m_max),
      tempMinC: at(d.temperature_2m_min),
      precipPct: at(d.precipitation_probability_max),
      windKmh: at(d.wind_speed_10m_max),
      uvIndex: at(d.uv_index_max),
      sunrise: at(d.sunrise),
      sunset: at(d.sunset),
      weatherCode: at(d.weather_code),
      latitude: json && json.latitude,
      longitude: json && json.longitude
    };
  }

  function fetchWithTimeout(url, ms) {
    if (typeof AbortController === 'undefined') {
      // Older browsers — no abort, but fetch alone has built-in timeouts on most platforms.
      return fetch(url);
    }
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(url, { signal: ctl.signal }).finally(function () { clearTimeout(t); });
  }

  async function fetchToday(lat, lng) {
    const date = todayDateStr();
    const key = cacheKey(date, lat, lng);
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const data = JSON.parse(cached);
        if (data && data._fetchedAt && Date.now() - data._fetchedAt < CACHE_TTL_MS) {
          return data;
        }
      }
    } catch (e) { /* ignore */ }

    const res = await fetchWithTimeout(buildUrl(lat, lng), TIMEOUT_MS);
    if (!res.ok) throw new Error('weather API ' + res.status);
    const json = await res.json();
    const data = parseOpenMeteo(json);
    data._fetchedAt = Date.now();
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* quota */ }
    return data;
  }

  // Map Open-Meteo WMO weather code → Japanese label + emoji
  function weatherCodeLabel(code) {
    if (code == null) return { emoji: '🌤', label: '—' };
    if (code === 0) return { emoji: '☀️', label: '快晴' };
    if (code === 1) return { emoji: '🌤', label: '晴れ' };
    if (code === 2) return { emoji: '⛅', label: '一部曇り' };
    if (code === 3) return { emoji: '☁️', label: '曇り' };
    if (code === 45 || code === 48) return { emoji: '🌫', label: '霧' };
    if (code >= 51 && code <= 57) return { emoji: '🌦', label: '霧雨' };
    if (code >= 61 && code <= 65) return { emoji: '🌧', label: '雨' };
    if (code >= 66 && code <= 67) return { emoji: '🌨', label: '凍雨' };
    if (code >= 71 && code <= 77) return { emoji: '❄️', label: '雪' };
    if (code >= 80 && code <= 82) return { emoji: '🌧', label: 'にわか雨' };
    if (code >= 85 && code <= 86) return { emoji: '🌨', label: '雪雪' };
    if (code >= 95) return { emoji: '⛈', label: '雷雨' };
    return { emoji: '🌤', label: '—' };
  }

  // Severity classification consistent with course.weatherCriteria.
  // Returns 'danger' | 'warning' | null and a human label.
  function severityFor(data) {
    if (!data) return null;
    const warnings = [];
    if (data.precipPct != null && data.precipPct >= 60) warnings.push({ level: 'danger', text: '降水確率 ' + data.precipPct + '% — 中止を強く推奨' });
    else if (data.precipPct != null && data.precipPct >= 40) warnings.push({ level: 'warning', text: '降水確率 ' + data.precipPct + '% — レインウェア必携、雷予報なら中止' });
    if (data.windKmh != null && data.windKmh >= 54) warnings.push({ level: 'danger', text: '風速 ' + Math.round(data.windKmh / 3.6) + 'm/s 予報 — 稜線通過は危険' });
    if (data.tempMaxC != null && data.tempMaxC >= 35) warnings.push({ level: 'warning', text: '最高気温 ' + data.tempMaxC + '℃ — 熱中症リスク極大' });
    if (data.tempMinC != null && data.tempMinC <= 0) warnings.push({ level: 'warning', text: '最低気温 ' + data.tempMinC + '℃ — 凍結リスク、チェーンスパイク携行' });
    if (data.uvIndex != null && data.uvIndex >= 8) warnings.push({ level: 'info', text: 'UV指数 ' + data.uvIndex.toFixed(1) + ' — 日焼け止め必須' });
    return warnings;
  }

  function formatHM(iso) {
    if (!iso || typeof iso !== 'string') return '—';
    const m = iso.match(/T(\d{2}):(\d{2})/);
    return m ? m[1] + ':' + m[2] : '—';
  }

  /**
   * Render a weather card into the given container element.
   * If data is null, the container is hidden.
   */
  function renderCard(container, data) {
    if (!container) return;
    if (!data) { container.hidden = true; container.innerHTML = ''; return; }
    container.hidden = false;
    const cl = weatherCodeLabel(data.weatherCode);
    const warnings = severityFor(data);
    const warnHtml = warnings.length
      ? warnings.map(function (w) {
          return '<div class="weather-warn weather-warn-' + w.level + '">' + escapeHtml(w.text) + '</div>';
        }).join('')
      : '';
    container.innerHTML =
      '<div class="weather-card-head">' +
      '  <span class="weather-emoji">' + cl.emoji + '</span>' +
      '  <span class="weather-condition">' + escapeHtml(cl.label) + '</span>' +
      '  <span class="weather-temp">' +
      (data.tempMaxC != null ? data.tempMaxC.toFixed(1) + '℃' : '—') + ' / ' +
      (data.tempMinC != null ? data.tempMinC.toFixed(1) + '℃' : '—') +
      '  </span>' +
      '</div>' +
      '<div class="weather-card-row">' +
      '  <span><b>降水</b> ' + (data.precipPct != null ? data.precipPct + '%' : '—') + '</span>' +
      '  <span><b>風</b> ' + (data.windKmh != null ? data.windKmh.toFixed(1) + 'km/h' : '—') + '</span>' +
      '  <span><b>UV</b> ' + (data.uvIndex != null ? data.uvIndex.toFixed(1) : '—') + '</span>' +
      '</div>' +
      '<div class="weather-card-row">' +
      '  <span><b>日出</b> ' + formatHM(data.sunrise) + '</span>' +
      '  <span><b>日没</b> ' + formatHM(data.sunset) + '</span>' +
      '  <span class="weather-source">Open-Meteo</span>' +
      '</div>' +
      warnHtml;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  window.Weather = {
    fetchToday: fetchToday,
    renderCard: renderCard,
    severityFor: severityFor,
    weatherCodeLabel: weatherCodeLabel,
    // Internal — for tests
    _parseOpenMeteo: parseOpenMeteo,
    _cacheKey: cacheKey,
    _todayDateStr: todayDateStr
  };
})();
