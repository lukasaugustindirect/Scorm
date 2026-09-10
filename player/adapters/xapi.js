/* xAPI (Experience API) 1.0.3 adapter.
 *
 * Uses the launch convention established by Rustici's TinCan packaging, which
 * is what LMSs that "support xAPI packages" almost universally implement: the
 * content is opened with endpoint, auth, actor, registration and activity_id
 * on the query string. Unlike cmi5 this is a de-facto convention rather than a
 * ratified standard, so every parameter is treated as optional and a missing
 * one degrades to running unconnected instead of failing.
 *
 * Statements are addressed to {endpoint}statements and resume state to
 * {endpoint}activities/state, both requiring the X-Experience-API-Version
 * header.
 */
window.PdfScormAdapter = (function () {
  'use strict';

  var VERSION = '1.0.3';
  var VERBS = {
    initialized: 'http://adlnet.gov/expapi/verbs/initialized',
    experienced: 'http://adlnet.gov/expapi/verbs/experienced',
    completed: 'http://adlnet.gov/expapi/verbs/completed',
    passed: 'http://adlnet.gov/expapi/verbs/passed',
    failed: 'http://adlnet.gov/expapi/verbs/failed',
    terminated: 'http://adlnet.gov/expapi/verbs/terminated',
  };
  var DISPLAY = {
    initialized: 'initialized', experienced: 'experienced', completed: 'completed',
    passed: 'passed', failed: 'failed', terminated: 'terminated',
  };
  var STATE_ID = 'bookmark';

  var config = null;
  var courseName = 'Course';
  var mastery = null;
  var perPage = false;
  var reported = Object.create(null);
  var startedAt = Date.now();

  function readLaunch() {
    var q = new URLSearchParams(window.location.search);
    var endpoint = q.get('endpoint');
    var actor = q.get('actor');
    if (!endpoint || !actor) return null;

    try {
      actor = JSON.parse(actor);
    } catch (e) {
      return null;
    }

    var auth = q.get('auth') || '';
    // Rustici sends a complete header value; other hosts send a bare token.
    if (auth && !/^(Basic|Bearer)\s/i.test(auth)) auth = 'Basic ' + auth;

    return {
      endpoint: endpoint.replace(/\/?$/, '/'),
      auth: auth,
      actor: actor,
      registration: q.get('registration') || '',
      activityId: q.get('activity_id') || q.get('activityId') || window.location.href.split('?')[0],
    };
  }

  function headers() {
    var head = {
      'X-Experience-API-Version': VERSION,
      'Content-Type': 'application/json',
    };
    if (config.auth) head.Authorization = config.auth;
    return head;
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // RFC 4122 version 4 layout, built from whatever randomness is available.
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = [];
    for (var b = 0; b < 16; b++) hex.push((bytes[b] + 0x100).toString(16).slice(1));
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
           hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
           hex.slice(10, 16).join('');
  }

  function elapsed() {
    return Math.round((Date.now() - startedAt) / 1000);
  }

  function duration(seconds) {
    var whole = Math.max(0, Math.floor(seconds));
    var h = Math.floor(whole / 3600);
    var m = Math.floor((whole % 3600) / 60);
    var s = whole % 60;
    var out = 'PT';
    if (h) out += h + 'H';
    if (m) out += m + 'M';
    if (s || (!h && !m)) out += s + 'S';
    return out;
  }

  function statement(verb, object, result) {
    var body = {
      id: uuid(),
      actor: config.actor,
      verb: { id: VERBS[verb], display: { 'en-US': DISPLAY[verb] } },
      object: object,
      timestamp: new Date().toISOString(),
    };
    if (result) body.result = result;
    if (config.registration) body.context = { registration: config.registration };
    return body;
  }

  function course() {
    return {
      id: config.activityId,
      definition: {
        type: 'http://adlnet.gov/expapi/activities/course',
        name: { 'en-US': courseName },
      },
    };
  }

  function pageObject(n) {
    var object = {
      // A sub-activity IRI derived from the course keeps page-level statements
      // groupable without inventing a registered activity type for "page".
      id: config.activityId.replace(/\/?$/, '/') + 'pages/' + n,
      definition: { name: { 'en-US': 'Page ' + n } },
    };
    return object;
  }

  function send(body, options) {
    var opts = options || {};
    var request = {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    };
    // On unload the request must outlive the document; keepalive is the only
    // way to do that and still set an Authorization header.
    if (opts.keepalive) request.keepalive = true;

    return fetch(config.endpoint + 'statements', request).then(function (res) {
      if (!res.ok) throw new Error('LRS returned ' + res.status);
      return res;
    });
  }

  function sendQuietly(body, options) {
    try {
      var promise = send(body, options);
      if (promise && promise.catch) {
        promise.catch(function (err) {
          if (window.console) console.warn('xAPI statement failed:', err);
        });
      }
    } catch (err) {
      if (window.console) console.warn('xAPI statement failed:', err);
    }
  }

  function stateUrl() {
    var q = new URLSearchParams({
      activityId: config.activityId,
      agent: JSON.stringify(config.actor),
      stateId: STATE_ID,
    });
    if (config.registration) q.set('registration', config.registration);
    return config.endpoint + 'activities/state?' + q.toString();
  }

  function loadState() {
    return fetch(stateUrl(), { headers: headers() })
      .then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('state GET ' + res.status);
        return res.json();
      })
      .catch(function () { return null; });
  }

  function saveState(state, options) {
    var request = { method: 'PUT', headers: headers(), body: JSON.stringify(state) };
    if (options && options.keepalive) request.keepalive = true;
    return fetch(stateUrl(), request).catch(function (err) {
      if (window.console) console.warn('xAPI state PUT failed:', err);
    });
  }

  return {
    label: 'xAPI',

    init: function (manifest) {
      courseName = (manifest && manifest.title) || 'Course';
      mastery = manifest && manifest.masteryScore != null ? Number(manifest.masteryScore) : null;
      perPage = !(manifest && manifest.xapi && manifest.xapi.perPageStatements === false);

      config = readLaunch();
      startedAt = Date.now();
      if (!config) {
        return { connected: false, error: 'no xAPI launch parameters' };
      }

      sendQuietly(statement('initialized', course()));

      return loadState().then(function (state) {
        return {
          connected: true,
          learnerName: (config.actor && (config.actor.name ||
            (config.actor.account && config.actor.account.name))) || '',
          // Plain xAPI launch carries no browse/review distinction.
          mode: 'normal',
          state: state,
        };
      });
    },

    saveProgress: function (progress) {
      if (!config) return;

      // Driven off the visited list rather than progress.page: the player
      // debounces saves, so paging quickly through a document coalesces several
      // page turns into one call. Reporting only the current page would silently
      // drop the ones passed over, which is exactly what per-page tracking is
      // supposed to capture.
      if (perPage) {
        var seen = progress.visited || [progress.page];
        for (var i = 0; i < seen.length; i++) {
          if (!reported[seen[i]]) {
            reported[seen[i]] = true;
            sendQuietly(statement('experienced', pageObject(seen[i])));
          }
        }
      }

      saveState({
        page: progress.page,
        visited: progress.visited,
        percent: progress.percent,
      });
    },

    setComplete: function (info) {
      if (!config) return;
      var result = { completion: true, duration: duration(elapsed()) };
      if (mastery != null && info.score != null) {
        result.score = { scaled: Number(info.score.toFixed(4)) };
        result.success = info.score >= mastery;
      }
      sendQuietly(statement('completed', course(), result));

      if (mastery != null && info.score != null) {
        sendQuietly(statement(info.score >= mastery ? 'passed' : 'failed', course(), result));
      }
    },

    finish: function (info) {
      if (!config) return;
      sendQuietly(
        statement('terminated', course(), { duration: duration(info.seconds) }),
        { keepalive: true },
      );
    },
  };
})();
