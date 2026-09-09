/* SCORM 2004 4th Edition run-time adapter.
 *
 * Data model reference: ADL SCORM 2004 4th Edition Run-Time Environment.
 * What differs from 1.2 and matters here:
 *   - the API object is API_1484_11, and the calls lost their LMS prefix
 *     (Initialize / Terminate rather than LMSInitialize / LMSFinish).
 *   - completion and success are separate: cmi.completion_status says whether
 *     the material was finished, cmi.success_status whether it was passed.
 *   - cmi.score.scaled is the primary score and runs -1..1, not 0..100.
 *   - cmi.progress_measure (0..1) lets the LMS show partial progress.
 *   - cmi.session_time is an ISO 8601 duration, not HHHH:MM:SS.SS.
 *   - cmi.suspend_data has a 64000-character SPM, up from 4096.
 *   - cmi.mode reports browse / normal / review, which 1.2 had no concept of.
 */
window.PdfScormAdapter = (function () {
  'use strict';

  var SUSPEND_LIMIT = 64000;
  var api = null;
  var live = false;
  var mastery = null;

  function findIn(win) {
    var hops = 0;
    while (win && hops < 50) {
      if (win.API_1484_11) return win.API_1484_11;
      if (!win.parent || win.parent === win) return null;
      win = win.parent;
      hops++;
    }
    return null;
  }

  function locate() {
    try {
      var found = findIn(window);
      if (found) return found;
    } catch (e) { /* cross-origin frame; keep looking */ }
    try {
      if (window.opener) return findIn(window.opener);
    } catch (e) { /* opener is cross-origin */ }
    return null;
  }

  function lastError() {
    try { return String(api.GetLastError()); } catch (e) { return '0'; }
  }

  function get(key) {
    try {
      var value = api.GetValue(key);
      return lastError() === '0' ? String(value) : '';
    } catch (e) { return ''; }
  }

  function set(key, value) {
    try {
      var ok = String(api.SetValue(key, String(value))) === 'true';
      if (!ok && window.console) {
        console.warn('SetValue(' + key + ') error ' + lastError());
      }
      return ok;
    } catch (e) { return false; }
  }

  function commit() {
    try { api.Commit(''); } catch (e) { /* nothing useful to do */ }
  }

  /* ---- bookmark codec (same shape as the 1.2 adapter) ---- */

  function encode(page, visited, total) {
    var bytes = new Uint8Array(Math.ceil(total / 8));
    for (var i = 0; i < visited.length; i++) {
      var bit = visited[i] - 1;
      if (bit >= 0 && bit < total) bytes[bit >> 3] |= 128 >> (bit & 7);
    }
    var raw = '';
    for (var b = 0; b < bytes.length; b++) raw += String.fromCharCode(bytes[b]);
    return page + '~' + btoa(raw);
  }

  function decode(text, total) {
    if (!text) return null;
    var parts = String(text).split('~');
    var page = parseInt(parts[0], 10);
    var visited = [];
    if (parts[1]) {
      try {
        var raw = atob(parts[1]);
        for (var n = 0; n < total; n++) {
          if (raw.charCodeAt(n >> 3) & (128 >> (n & 7))) visited.push(n + 1);
        }
      } catch (e) { /* corrupt bitfield; the page number still works */ }
    }
    return { page: isFinite(page) && page > 0 ? page : 1, visited: visited };
  }

  function duration(seconds) {
    var whole = Math.max(0, Math.floor(seconds));
    var h = Math.floor(whole / 3600);
    var m = Math.floor((whole % 3600) / 60);
    var s = whole % 60;
    // "PT0S" is the shortest legal form; omitting zero components is allowed
    // but at least one must be present.
    var out = 'PT';
    if (h) out += h + 'H';
    if (m) out += m + 'M';
    if (s || (!h && !m)) out += s + 'S';
    return out;
  }

  return {
    label: 'SCORM 2004 4th Edition',

    init: function (manifest) {
      mastery = manifest && manifest.masteryScore != null
        ? Number(manifest.masteryScore) : null;

      api = locate();
      if (!api) return { connected: false, error: 'SCORM API not found' };

      try {
        live = String(api.Initialize('')) === 'true';
      } catch (e) {
        live = false;
      }
      if (!live) {
        // 103 is "already initialized", which a re-entry can legitimately hit.
        var code = lastError();
        if (code !== '0' && code !== '103') {
          return { connected: false, error: 'Initialize failed (' + code + ')' };
        }
        live = true;
      }

      var total = (manifest.pages || []).length;
      var state = decode(get('cmi.suspend_data'), total);
      if (!state) {
        var location = parseInt(get('cmi.location'), 10);
        if (isFinite(location) && location > 0) state = { page: location, visited: [] };
      }

      if (!get('cmi.completion_status') || get('cmi.completion_status') === 'unknown') {
        set('cmi.completion_status', 'incomplete');
        commit();
      }

      // The LMS may carry a scaled passing score from the manifest; it
      // overrides whatever the package was built with.
      var fromLms = parseFloat(get('cmi.scaled_passing_score'));
      if (isFinite(fromLms)) mastery = fromLms;

      // "no-credit" means the attempt does not count, so treat it like review
      // and stop the player from recording results.
      var mode = get('cmi.mode') || 'normal';
      if (get('cmi.credit') === 'no-credit') mode = 'review';

      return {
        connected: true,
        learnerName: get('cmi.learner_name'),
        mode: mode === 'browse' || mode === 'review' ? mode : 'normal',
        state: state,
      };
    },

    saveProgress: function (progress) {
      if (!live) return;
      set('cmi.location', String(progress.page).slice(0, 1000));
      set('cmi.progress_measure', (progress.percent / 100).toFixed(4));

      var packed = encode(progress.page, progress.visited, progress.totalPages);
      if (packed.length <= SUSPEND_LIMIT) set('cmi.suspend_data', packed);
      commit();
    },

    setComplete: function (info) {
      if (!live) return;
      set('cmi.completion_status', 'completed');
      // Same 4-decimal form saveProgress uses; that call is debounced and so
      // usually lands last, and differing formats look like a bug in reports.
      set('cmi.progress_measure', (1).toFixed(4));

      if (mastery != null && info.score != null) {
        set('cmi.score.scaled', info.score.toFixed(4));
        set('cmi.score.raw', String(Math.round(info.score * 100)));
        set('cmi.score.min', '0');
        set('cmi.score.max', '100');
        set('cmi.success_status', info.score >= mastery ? 'passed' : 'failed');
      }
      commit();
    },

    finish: function (info) {
      if (!live) return;
      set('cmi.session_time', duration(info.seconds));
      set('cmi.exit', info.complete ? 'normal' : 'suspend');
      commit();
      try { api.Terminate(''); } catch (e) { /* session is going away anyway */ }
      live = false;
    },
  };
})();
