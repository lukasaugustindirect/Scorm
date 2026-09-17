/* cmi5 adapter (AU side).
 *
 * Spec: AICC cmi5, https://github.com/AICC/CMI-5_Spec_Current. cmi5 is much
 * stricter than plain xAPI about what the AU must do, and the rules that shape
 * this file are:
 *   - launch carries endpoint, fetch, actor, registration and activityId.
 *   - the AU POSTs (never GETs) the one-time fetch URL to obtain an
 *     auth-token, then sends it as HTTP Basic on every xAPI request.
 *   - the AU reads the LMS.LaunchData State document and MUST use its
 *     contextTemplate as the base context of every statement, without
 *     overwriting anything in it. The session id lives in there.
 *   - the AU MUST NOT modify or delete LMS.LaunchData, so the resume bookmark
 *     goes in a separate State document.
 *   - "Initialized" MUST be the first statement of the session and
 *     "Terminated" the last; Completed, Passed and Failed MUST carry a
 *     duration; statement ids MUST be UUIDs.
 *   - cmi5-defined statements MUST carry the cmi5 category activity, and any
 *     statement whose result has completion or success MUST also carry the
 *     moveon category.
 *   - launchMode Browse or Review forbids everything except Initialized and
 *     Terminated.
 *   - Launched, Waived, Satisfied and Abandoned belong to the LMS, not the AU.
 */
window.PdfScormAdapter = (function () {
  'use strict';

  var VERSION = '1.0.3';
  var VERBS = {
    initialized: 'http://adlnet.gov/expapi/verbs/initialized',
    completed: 'http://adlnet.gov/expapi/verbs/completed',
    passed: 'http://adlnet.gov/expapi/verbs/passed',
    failed: 'http://adlnet.gov/expapi/verbs/failed',
    terminated: 'http://adlnet.gov/expapi/verbs/terminated',
  };
  var CATEGORY_CMI5 = 'https://w3id.org/xapi/cmi5/context/categories/cmi5';
  var CATEGORY_MOVEON = 'https://w3id.org/xapi/cmi5/context/categories/moveon';
  var LAUNCH_STATE = 'LMS.LaunchData';
  var BOOKMARK_STATE = 'pdf-scorm.bookmark';

  var config = null;
  var token = '';
  var launchData = {};
  var courseName = 'Course';
  var mastery = null;
  var moveOn = 'NotApplicable';
  var mode = 'normal';
  var startedAt = Date.now();
  var completedSent = false;

  function readLaunch() {
    var q = new URLSearchParams(window.location.search);
    var endpoint = q.get('endpoint');
    var actor = q.get('actor');
    var activityId = q.get('activityId');
    var fetchUrl = q.get('fetch');
    if (!endpoint || !actor || !activityId) return null;

    try {
      actor = JSON.parse(actor);
    } catch (e) {
      return null;
    }

    return {
      endpoint: endpoint.replace(/\/?$/, '/'),
      fetchUrl: fetchUrl || '',
      actor: actor,
      registration: q.get('registration') || '',
      activityId: activityId,
    };
  }

  function headers(withContentType) {
    var head = { 'X-Experience-API-Version': VERSION };
    if (token) head.Authorization = 'Basic ' + token;
    if (withContentType) head['Content-Type'] = 'application/json';
    return head;
  }

  function getToken() {
    if (!config.fetchUrl) return Promise.resolve('');
    // A GET is explicitly disallowed here so the response cannot be cached.
    return fetch(config.fetchUrl, { method: 'POST' })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (body && body['auth-token']) return body['auth-token'];
        var text = body && (body['error-text'] || body['error-code']);
        throw new Error('fetch URL returned no token' + (text ? ': ' + text : ''));
      });
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
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

  /* ---- context assembly ---- */

  function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : {};
  }

  function asList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function withCategory(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list;
    list.push({ id: id });
    return list;
  }

  function context(hasMoveOnResult) {
    // contextTemplate is authoritative: it carries the LMS session id and the
    // publisher-id grouping activity, and must survive intact.
    var ctx = clone(launchData.contextTemplate);
    if (!ctx.registration && config.registration) ctx.registration = config.registration;

    ctx.contextActivities = ctx.contextActivities || {};
    var category = withCategory(asList(ctx.contextActivities.category), CATEGORY_CMI5);
    if (hasMoveOnResult) category = withCategory(category, CATEGORY_MOVEON);
    ctx.contextActivities.category = category;
    return ctx;
  }

  function object() {
    return {
      id: config.activityId,
      definition: {
        type: 'http://adlnet.gov/expapi/activities/lesson',
        name: { 'en-US': courseName },
      },
    };
  }

  function statement(verb, result) {
    var hasMoveOn = !!(result && (result.completion !== undefined || result.success !== undefined));
    var body = {
      id: uuid(),
      actor: config.actor,
      verb: { id: VERBS[verb], display: { 'en-US': verb } },
      object: object(),
      context: context(hasMoveOn),
      timestamp: new Date().toISOString(),
    };
    if (result) body.result = result;
    return body;
  }

  function send(body, options) {
    var request = { method: 'POST', headers: headers(true), body: JSON.stringify(body) };
    if (options && options.keepalive) request.keepalive = true;
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
          if (window.console) console.warn('cmi5 statement failed:', err);
        });
      }
    } catch (err) {
      if (window.console) console.warn('cmi5 statement failed:', err);
    }
  }

  /* ---- state ---- */

  function stateUrl(stateId) {
    var q = new URLSearchParams({
      activityId: config.activityId,
      agent: JSON.stringify(config.actor),
      stateId: stateId,
    });
    if (config.registration) q.set('registration', config.registration);
    return config.endpoint + 'activities/state?' + q.toString();
  }

  function loadState(stateId) {
    return fetch(stateUrl(stateId), { headers: headers(false) })
      .then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('state GET ' + res.status);
        return res.json();
      })
      .catch(function () { return null; });
  }

  function saveBookmark(state) {
    return fetch(stateUrl(BOOKMARK_STATE), {
      method: 'PUT',
      headers: headers(true),
      body: JSON.stringify(state),
    }).catch(function (err) {
      if (window.console) console.warn('cmi5 bookmark PUT failed:', err);
    });
  }

  function passRequired() {
    return moveOn === 'Passed' || moveOn === 'CompletedAndPassed' || moveOn === 'CompletedOrPassed';
  }

  return {
    label: 'cmi5',

    init: function (manifest) {
      courseName = (manifest && manifest.title) || 'Course';
      config = readLaunch();
      if (!config) return Promise.resolve({ connected: false, error: 'no cmi5 launch parameters' });

      startedAt = Date.now();

      return getToken()
        .then(function (value) {
          token = value;
          return loadState(LAUNCH_STATE);
        })
        .then(function (data) {
          launchData = data || {};

          if (launchData.masteryScore != null) mastery = Number(launchData.masteryScore);
          else if (manifest && manifest.masteryScore != null) mastery = Number(manifest.masteryScore);

          moveOn = launchData.moveOn || (manifest && manifest.cmi5 && manifest.cmi5.moveOn) ||
            'NotApplicable';

          var launchMode = String(launchData.launchMode || 'Normal').toLowerCase();
          mode = launchMode === 'browse' || launchMode === 'review' ? launchMode : 'normal';

          // Initialized has to be the first statement of any kind.
          sendQuietly(statement('initialized'));

          return loadState(BOOKMARK_STATE);
        })
        .then(function (bookmark) {
          return {
            connected: true,
            learnerName: (config.actor && (config.actor.name ||
              (config.actor.account && config.actor.account.name))) || '',
            mode: mode,
            state: bookmark,
            returnUrl: launchData.returnURL || '',
          };
        })
        .catch(function (err) {
          return { connected: false, error: String(err.message || err) };
        });
    },

    saveProgress: function (progress) {
      if (!config || mode !== 'normal') return;
      saveBookmark({
        page: progress.page,
        visited: progress.visited,
        percent: progress.percent,
      });
    },

    setComplete: function (info) {
      if (!config || mode !== 'normal' || completedSent) return;
      completedSent = true;

      var seconds = elapsed();
      var result = { completion: true, duration: duration(seconds) };
      if (mastery != null && info.score != null) {
        result.score = { scaled: Number(info.score.toFixed(4)) };
      }
      sendQuietly(statement('completed', result));

      // Without this the learner finishes the material but never satisfies a
      // moveOn of Passed, so the LMS leaves the course unsatisfied.
      if (passRequired() || mastery != null) {
        var passed = mastery == null || (info.score != null && info.score >= mastery);
        var judged = { success: passed, duration: duration(seconds) };
        if (mastery != null && info.score != null) {
          judged.score = { scaled: Number(info.score.toFixed(4)) };
        }
        sendQuietly(statement(passed ? 'passed' : 'failed', judged));
      }
    },

    finish: function (info) {
      if (!config) return;
      // Terminated must be the last statement the AU records this session.
      sendQuietly(
        statement('terminated', { duration: duration(info.seconds || elapsed()) }),
        { keepalive: true },
      );
    },
  };
})();
