/* Kyoto Trail Plan — Progress Store
 *
 * localStorage-backed progress tracking.
 * Persistence shape (key "ktp.progress.v1"):
 *   {
 *     schemaVersion: 1,
 *     user: { weightKg, gearKg },
 *     courses: {
 *       [courseId]: {
 *         coveredIntervalsKm: [[from, to], ...],   // sorted, non-overlapping, on-route distance ranges
 *         totalCoveredKm: number,                   // sum of interval widths
 *         completedAt: ISOString | null,            // set when totalCoveredKm >= totalDistanceKm * threshold
 *         sessions: [
 *           { sessionId, startedAt, endedAt|null, distanceKm, elapsedMs, calories, lastDistanceKm }
 *         ]
 *       }
 *     }
 *   }
 *
 * Intervals are merged on insert so storage stays small even after many sessions.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ktp.progress.v1';
  const SCHEMA_VERSION = 1;
  const COMPLETION_THRESHOLD = 0.95;          // GPS drift tolerance for "完歩"
  const SAVE_DEBOUNCE_MS = 5000;
  const MIN_INTERVAL_DELTA_KM = 0.005;        // ignore intervals < 5 m
  const MAX_FORWARD_JUMP_KM = 0.5;            // single update can claim at most 500 m of forward progress

  let _state = null;
  let _saveTimer = null;

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      user: {
        weightKg: 60,
        gearKg: 5,
        powerMode: 'eco',         // 'eco' (Wake Lock off, gap interpolation on) | 'always-on' (Wake Lock kept)
        routeToleranceM: 50       // Tolerance window for route-snap interpolation (50/100/150)
      },
      courses: {}
    };
  }

  function emptyCourse() {
    return {
      coveredIntervalsKm: [],
      totalCoveredKm: 0,
      completedAt: null,
      sessions: []
    };
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== SCHEMA_VERSION) {
        console.warn('ProgressStore: schema mismatch, resetting');
        return emptyState();
      }
      // Defensive normalization (back-fill defaults for newer fields)
      if (!parsed.user) parsed.user = {};
      if (parsed.user.weightKg == null) parsed.user.weightKg = 60;
      if (parsed.user.gearKg == null) parsed.user.gearKg = 5;
      if (parsed.user.powerMode !== 'always-on') parsed.user.powerMode = 'eco';
      if (parsed.user.routeToleranceM !== 100 && parsed.user.routeToleranceM !== 150) {
        parsed.user.routeToleranceM = 50;
      }
      if (!parsed.courses) parsed.courses = {};
      Object.keys(parsed.courses).forEach(function (id) {
        const c = parsed.courses[id];
        if (!Array.isArray(c.coveredIntervalsKm)) c.coveredIntervalsKm = [];
        if (typeof c.totalCoveredKm !== 'number') c.totalCoveredKm = 0;
        if (!Array.isArray(c.sessions)) c.sessions = [];
        if (c.completedAt === undefined) c.completedAt = null;
      });
      return parsed;
    } catch (e) {
      console.warn('ProgressStore: failed to parse, resetting', e);
      return emptyState();
    }
  }

  function persistNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch (e) {
      console.warn('ProgressStore: persist failed', e);
    }
  }

  function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      _saveTimer = null;
      persistNow();
    }, SAVE_DEBOUNCE_MS);
  }

  // Union [from, to] into sorted non-overlapping intervals. O(n) per insert.
  function unionInterval(intervals, from, to) {
    if (to <= from) return intervals;
    const merged = [];
    let curFrom = from;
    let curTo = to;
    let consumed = false;
    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i];
      if (iv[1] < curFrom) {
        merged.push(iv.slice());
      } else if (iv[0] > curTo) {
        if (!consumed) { merged.push([curFrom, curTo]); consumed = true; }
        merged.push(iv.slice());
      } else {
        // overlap
        curFrom = Math.min(curFrom, iv[0]);
        curTo = Math.max(curTo, iv[1]);
      }
    }
    if (!consumed) merged.push([curFrom, curTo]);
    return merged;
  }

  function intervalsTotal(intervals) {
    let sum = 0;
    for (let i = 0; i < intervals.length; i++) sum += intervals[i][1] - intervals[i][0];
    return sum;
  }

  function nowIso() { return new Date().toISOString(); }

  function getOrCreateCourse(courseId) {
    if (!_state.courses[courseId]) _state.courses[courseId] = emptyCourse();
    return _state.courses[courseId];
  }

  function init() {
    if (_state) return;
    _state = loadFromStorage();

    // Best-effort flush on hide / close
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
        persistNow();
      }
    });
    window.addEventListener('beforeunload', function () {
      if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
      persistNow();
    });
  }

  // --- Public API ---

  /** Add forward progress interval [from, to]. Returns { added: bool, newTotalKm, justCompleted: bool }. */
  function addInterval(courseId, fromKm, toKm, courseTotalKm) {
    if (!_state) init();
    if (!isFinite(fromKm) || !isFinite(toKm)) return { added: false };
    if (toKm <= fromKm) return { added: false };
    if (toKm - fromKm < MIN_INTERVAL_DELTA_KM) return { added: false };
    if (toKm - fromKm > MAX_FORWARD_JUMP_KM) {
      // Single update too long — likely GPS jitter or tab-resume gap.
      // Phase 2 ignores this; Phase 2.7 will handle visibility-gap interpolation explicitly.
      return { added: false, reason: 'jump_too_large' };
    }
    const c = getOrCreateCourse(courseId);
    const before = c.totalCoveredKm;
    c.coveredIntervalsKm = unionInterval(c.coveredIntervalsKm, fromKm, toKm);
    c.totalCoveredKm = intervalsTotal(c.coveredIntervalsKm);
    const justCompleted = !c.completedAt
      && courseTotalKm
      && c.totalCoveredKm >= courseTotalKm * COMPLETION_THRESHOLD;
    if (justCompleted) c.completedAt = nowIso();
    if (c.totalCoveredKm > before) scheduleSave();
    return { added: c.totalCoveredKm > before, newTotalKm: c.totalCoveredKm, justCompleted: !!justCompleted };
  }

  /** Get a snapshot of a course's progress. Returns null if no record yet. */
  function getCourse(courseId) {
    if (!_state) init();
    return _state.courses[courseId] || null;
  }

  /** Loop progress sums over loopMember course IDs. Returns { totalCoveredKm, totalLoopKm, percent, completedCount }. */
  function getLoopProgress(coursesIndex) {
    if (!_state) init();
    let totalCoveredKm = 0;
    let totalLoopKm = 0;
    let completedCount = 0;
    let total = 0;
    coursesIndex.courses.forEach(function (meta) {
      if (!meta.loopMember) return;
      total++;
      const planned = meta.summary && meta.summary.totalDistanceKm;
      if (planned) totalLoopKm += planned;
      const c = _state.courses[meta.id];
      if (c) {
        totalCoveredKm += Math.min(c.totalCoveredKm, planned || c.totalCoveredKm);
        if (c.completedAt) completedCount++;
      }
    });
    return {
      totalCoveredKm: totalCoveredKm,
      totalLoopKm: totalLoopKm,
      percent: totalLoopKm > 0 ? totalCoveredKm / totalLoopKm : 0,
      completedCount: completedCount,
      totalCount: total,
      allCompleted: total > 0 && completedCount === total
    };
  }

  /** Start a new walking session for a course. */
  function startSession(courseId) {
    if (!_state) init();
    const c = getOrCreateCourse(courseId);
    const sessionId = 's' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const session = {
      sessionId: sessionId,
      startedAt: nowIso(),
      endedAt: null,
      distanceKm: 0,
      elapsedMs: 0,
      calories: 0,
      lastDistanceKm: 0
    };
    c.sessions.push(session);
    scheduleSave();
    return sessionId;
  }

  /** Update the in-progress session with the latest snapshot. */
  function updateSession(courseId, snapshot) {
    if (!_state) init();
    const c = _state.courses[courseId];
    if (!c || !c.sessions.length) return;
    const s = c.sessions[c.sessions.length - 1];
    if (s.endedAt) return; // already finalized
    if (snapshot.distanceKm != null) s.distanceKm = snapshot.distanceKm;
    if (snapshot.elapsedMs != null) s.elapsedMs = snapshot.elapsedMs;
    if (snapshot.calories != null) s.calories = snapshot.calories;
    if (snapshot.lastDistanceKm != null) s.lastDistanceKm = snapshot.lastDistanceKm;
    scheduleSave();
  }

  /** Finalize the most recent session for a course. */
  function endSession(courseId) {
    if (!_state) init();
    const c = _state.courses[courseId];
    if (!c || !c.sessions.length) return;
    const s = c.sessions[c.sessions.length - 1];
    if (s.endedAt) return;
    s.endedAt = nowIso();
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    persistNow();
  }

  /** Reset progress for one course (or all if courseId is null). */
  function reset(courseId) {
    if (!_state) init();
    if (courseId == null) {
      _state.courses = {};
    } else {
      delete _state.courses[courseId];
    }
    persistNow();
  }

  /** Update user settings (weight, gear, power mode, route tolerance). */
  function setUser(partial) {
    if (!_state) init();
    if (!_state.user) _state.user = { weightKg: 60, gearKg: 5, powerMode: 'eco', routeToleranceM: 50 };
    if (partial && typeof partial === 'object') {
      if (partial.weightKg != null) _state.user.weightKg = Number(partial.weightKg);
      if (partial.gearKg != null) _state.user.gearKg = Number(partial.gearKg);
      if (partial.powerMode === 'eco' || partial.powerMode === 'always-on') {
        _state.user.powerMode = partial.powerMode;
      }
      if (partial.routeToleranceM != null) {
        const t = Number(partial.routeToleranceM);
        if (t === 50 || t === 100 || t === 150) _state.user.routeToleranceM = t;
      }
    }
    scheduleSave();
  }

  function getUser() {
    if (!_state) init();
    return Object.assign({}, _state.user);
  }

  /** Export full state as a JSON string. */
  function exportJson() {
    if (!_state) init();
    return JSON.stringify(_state, null, 2);
  }

  /**
   * Merge an exported state from another device into the current state.
   * Strategy: union covered intervals per course; concat sessions (dedup by sessionId).
   */
  function importJson(jsonStr) {
    if (!_state) init();
    let imported;
    try { imported = JSON.parse(jsonStr); }
    catch (e) { return { ok: false, reason: 'invalid_json' }; }
    if (!imported || imported.schemaVersion !== SCHEMA_VERSION) {
      return { ok: false, reason: 'schema_mismatch' };
    }
    const importedCourses = imported.courses || {};
    Object.keys(importedCourses).forEach(function (id) {
      const incoming = importedCourses[id];
      const cur = getOrCreateCourse(id);
      // Union intervals
      (incoming.coveredIntervalsKm || []).forEach(function (iv) {
        if (Array.isArray(iv) && iv.length === 2) {
          cur.coveredIntervalsKm = unionInterval(cur.coveredIntervalsKm, iv[0], iv[1]);
        }
      });
      cur.totalCoveredKm = intervalsTotal(cur.coveredIntervalsKm);
      // Earliest completedAt wins (you're recognized as completed on the earlier date)
      if (incoming.completedAt) {
        if (!cur.completedAt || incoming.completedAt < cur.completedAt) {
          cur.completedAt = incoming.completedAt;
        }
      }
      // Concat sessions (dedup by sessionId)
      const seen = {};
      cur.sessions.forEach(function (s) { if (s.sessionId) seen[s.sessionId] = true; });
      (incoming.sessions || []).forEach(function (s) {
        if (s.sessionId && !seen[s.sessionId]) cur.sessions.push(s);
      });
      cur.sessions.sort(function (a, b) { return (a.startedAt || '').localeCompare(b.startedAt || ''); });
    });
    if (imported.user) {
      if (imported.user.weightKg != null && !_state.user.weightKg) _state.user.weightKg = imported.user.weightKg;
      if (imported.user.gearKg != null && !_state.user.gearKg) _state.user.gearKg = imported.user.gearKg;
    }
    persistNow();
    return { ok: true };
  }

  function flush() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    if (_state) persistNow();
  }

  // Expose for testing
  function _getState() { return _state; }
  function _setState(s) { _state = s; }

  window.ProgressStore = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    COMPLETION_THRESHOLD: COMPLETION_THRESHOLD,
    init: init,
    addInterval: addInterval,
    getCourse: getCourse,
    getLoopProgress: getLoopProgress,
    startSession: startSession,
    updateSession: updateSession,
    endSession: endSession,
    reset: reset,
    setUser: setUser,
    getUser: getUser,
    exportJson: exportJson,
    importJson: importJson,
    flush: flush,
    // Internal — for tests
    _unionInterval: unionInterval,
    _intervalsTotal: intervalsTotal,
    _getState: _getState,
    _setState: _setState
  };
})();
