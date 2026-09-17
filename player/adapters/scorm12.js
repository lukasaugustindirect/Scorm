/* SCORM 1.2 run-time adapter.
 *
 * Data model reference: ADL SCORM 1.2 Run-Time Environment. The constraints
 * that actually shape this file:
 *   - cmi.suspend_data has a 4096-character SPM, so the bookmark is stored as
 *     a base64 bitfield rather than a JSON array of page numbers.
 *   - cmi.core.lesson_location has a 255-character SPM.
 *   - cmi.core.session_time is CMITimespan: HHHH:MM:SS.SS, hours 2-4 digits,
 *     minutes and seconds exactly 2.
 *   - cmi.core.score.raw is on a 0-100 scale (SCORM 2004 changed this).
 *
 * Each adapter is self-contained: exactly one ships in any given package, so a
 * few duplicated helpers are cheaper than an extra script tag to wire up.
 */
window.PdfScormAdapter = (function () {
  'use strict';

  var SUSPEND_LIMIT = 4096;
  var api = null;
  var live = false;
  var mastery = null;

  function findIn(win) {
    var hops = 0;
    // A deep frameset is unusual but legal; the cap only stops a cycle.
    while (win && hops < 50) {
      if (win.API) return win.API;
      if (!win.parent || win.parent === win) return null;
      win = win.parent;
      hops++;
    }
    return null;
  }

  function locate() {
    // Cross-origin frames throw on property access rather than returning
    // undefined, so every hop needs guarding.
    try {
      var found = findIn(window);
      if (found) return found;
    } catch (e) { /* keep looking */ }
    try {
      if (window.opener) return findIn(window.opener);
    } catch (e) { /* opener is cross-origin */ }
    return null;
  }

  function lastError() {
    try { return String(api.LMSGetLastError()); } catch (e) { return '0'; }
  }

  function get(key) {
    try {
      var value = api.LMSGetValue(key);
      return lastError() === '0' ? String(value) : '';
    } catch (e) { return ''; }
  }

  function set(key, value) {
    try {
      var ok = String(api.LMSSetValue(key, String(value))) === 'true';
      if (!ok && window.console) {
        console.warn('LMSSetValue(' + key + ') error ' + lastError());
      }
      return ok;
    } catch (e) { return false; }
  }

  function commit() {
    try { api.LMSCommit(''); } catch (e) { /* nothing useful to do */ }
  }

  /* ---- bookmark codec ---- */

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
      } catch (e) { /* a corrupt bitfield still leaves a usable page number */ }
    }
    return { page: isFinite(page) && page > 0 ? page : 1, visited: visited };
  }

  function timespan(seconds) {
    var whole = Math.floor(seconds);
    var h = Math.floor(whole / 3600);
    var m = Math.floor((whole % 3600) / 60);
    var s = whole % 60;
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2);
  }

  function pad(value, width) {
    var out = String(value);
    while (out.length < width) out = '0' + out;
    return out;
  }

  return {
    label: 'SCORM 1.2',

    init: function (manifest) {
      mastery = manifest && manifest.masteryScore != null
        ? Number(manifest.masteryScore) : null;

      api = locate();
      if (!api) return { connected: false, error: 'SCORM API not found' };

      try {
        live = String(api.LMSInitialize('')) === 'true';
      } catch (e) {
        live = false;
      }
      if (!live) {
        // Error 101 means the LMS considers the session already initialised,
        // which happens on a re-entry; treat that as usable rather than fatal.
        var code = lastError();
        if (code !== '0' && code !== '101') {
          return { connected: false, error: 'LMSInitialize failed (' + code + ')' };
        }
        live = true;
      }

      var total = (manifest.pages || []).length;
      var state = decode(get('cmi.suspend_data'), total);

      if (!state) {
        var location = parseInt(get('cmi.core.lesson_location'), 10);
        if (isFinite(location) && location > 0) state = { page: location, visited: [] };
      }

      // "not attempted" must become "incomplete" as soon as the learner is in,
      // otherwise a course exited early still reports as never opened.
      var status = get('cmi.core.lesson_status');
      if (!status || status === 'not attempted') {
        set('cmi.core.lesson_status', 'incomplete');
        commit();
      }

      if (mastery != null) {
        set('cmi.core.score.min', '0');
        set('cmi.core.score.max', '100');
      }

      return {
        connected: true,
        learnerName: get('cmi.core.student_name'),
        // SCORM 1.2 has no launch-mode concept; everything is a normal attempt.
        mode: 'normal',
        state: state,
      };
    },

    saveProgress: function (progress) {
      if (!live) return;
      set('cmi.core.lesson_location', String(progress.page).slice(0, 255));

      var packed = encode(progress.page, progress.visited, progress.totalPages);
      if (packed.length <= SUSPEND_LIMIT) {
        set('cmi.suspend_data', packed);
      } else if (window.console) {
        // Would need ~32k pages to reach this; recorded rather than silent.
        console.warn('suspend_data over 4096 chars; bookmark not stored');
      }
      commit();
    },

    setComplete: function (info) {
      if (!live) return;
      if (mastery != null && info.score != null) {
        var raw = Math.round(info.score * 100);
        set('cmi.core.score.raw', String(raw));
        set('cmi.core.lesson_status', info.score >= mastery ? 'passed' : 'failed');
      } else {
        set('cmi.core.lesson_status', 'completed');
      }
      commit();
    },

    finish: function (info) {
      if (!live) return;
      set('cmi.core.session_time', timespan(info.seconds));
      // "suspend" tells the LMS to keep suspend_data for the next attempt.
      set('cmi.core.exit', info.complete ? '' : 'suspend');
      commit();
      try { api.LMSFinish(''); } catch (e) { /* session is going away anyway */ }
      live = false;
    },
  };
})();
