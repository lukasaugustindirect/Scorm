/* Fake LMS.
 *
 * Stands in for an LMS so a built package can be exercised and watched. The
 * SCORM side is pure JavaScript: the adapters look for window.API or
 * window.API_1484_11 by walking up from the SCO's frame, so defining them here
 * is all an LMS really does. The xAPI and cmi5 side needs HTTP endpoints, which
 * server.js provides under /_lrs/ -- see the comment there about it being a
 * test double rather than an LRS.
 *
 * Everything the fake LMS "stores" lives in this page, so a reload is a fresh
 * enrolment and Relaunch is a returning learner.
 */
(function () {
  'use strict';

  var LRS = '/_lrs/';
  // Obviously synthetic: no real person's details belong in a test fixture.
  var LEARNER = { name: 'Test, Learner', id: 'learner-001' };

  var el = {};
  var model = Object.create(null);
  var calls = [];
  var current = { pkg: '', standard: '', registration: '', sessionId: '' };
  var statementTimer = null;

  document.addEventListener('DOMContentLoaded', function () {
    [
      'package', 'standard', 'mode', 'mode-field', 'mastery', 'launch', 'relaunch',
      'reset', 'sco', 'placeholder', 'summary', 'model-body', 'calls',
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    wireTabs();
    el.launch.addEventListener('click', function () { launch({ fresh: true }); });
    el.relaunch.addEventListener('click', function () { launch({ fresh: false }); });
    el.reset.addEventListener('click', resetAll);
    el.standard.addEventListener('change', syncControls);

    loadPackages();
  });

  /* ---------------- chrome ---------------- */

  function wireTabs() {
    var tabs = document.querySelectorAll('[role="tab"]');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (other) {
          var on = other === tab;
          other.setAttribute('aria-selected', String(on));
          document.getElementById('panel-' + other.dataset.tab).hidden = !on;
        });
      });
    });
  }

  function syncControls() {
    // Only SCORM 2004 and cmi5 have a launch-mode concept to emulate.
    var standard = el.standard.value === 'auto' ? current.standard : el.standard.value;
    el['mode-field'].hidden = !(standard === 'scorm2004' || standard === 'cmi5');
  }

  function loadPackages() {
    fetch(LRS + 'packages')
      .then(function (r) { return r.json(); })
      .then(function (body) {
        var list = body.packages || [];
        el.package.replaceChildren();
        if (!list.length) {
          var none = document.createElement('option');
          none.value = '';
          none.textContent = 'nothing unpacked yet';
          el.package.appendChild(none);
          el.launch.disabled = true;
          return;
        }
        list.forEach(function (name) {
          var option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          el.package.appendChild(option);
        });
        el.launch.disabled = false;
      })
      .catch(function () {
        el.package.replaceChildren();
        var option = document.createElement('option');
        option.textContent = 'server stub unavailable - run npm start';
        el.package.appendChild(option);
        el.launch.disabled = true;
      });
  }

  function record(fn, args, result) {
    calls.push({ fn: fn, args: args, result: result, at: new Date() });
    renderCalls();
  }

  function renderCalls() {
    var frag = document.createDocumentFragment();
    calls.slice(-300).forEach(function (call) {
      var li = document.createElement('li');
      var name = document.createElement('code');
      name.textContent = call.fn;
      li.appendChild(name);
      if (call.args && call.args.length) {
        var args = document.createElement('span');
        args.className = 'call__args';
        args.textContent = call.args.map(function (a) {
          var text = String(a);
          return text.length > 120 ? text.slice(0, 120) + '…' : text;
        }).join(', ');
        li.appendChild(args);
      }
      frag.appendChild(li);
    });
    el.calls.replaceChildren(frag);
    el.calls.scrollTop = el.calls.scrollHeight;
  }

  function renderModel() {
    var keys = Object.keys(model).sort();
    var frag = document.createDocumentFragment();
    keys.forEach(function (key) {
      var tr = document.createElement('tr');
      var th = document.createElement('td');
      th.textContent = key;
      var td = document.createElement('td');
      td.textContent = model[key];
      td.className = 'model__value';
      tr.append(th, td);
      frag.appendChild(tr);
    });
    el['model-body'].replaceChildren(frag);
  }

  function setSummary(text, state) {
    el.summary.textContent = text;
    el.summary.dataset.state = state || '';
  }

  /* ---------------- SCORM APIs ---------------- */

  function seedScorm12() {
    model = {
      'cmi.core.student_name': LEARNER.name,
      'cmi.core.student_id': LEARNER.id,
      'cmi.core.lesson_status': 'not attempted',
      'cmi.core.credit': 'credit',
      'cmi.core.entry': 'ab-initio',
      'cmi.core.lesson_location': '',
      'cmi.suspend_data': '',
    };
  }

  function seedScorm2004() {
    model = {
      'cmi.learner_name': LEARNER.name,
      'cmi.learner_id': LEARNER.id,
      'cmi.completion_status': 'unknown',
      'cmi.success_status': 'unknown',
      'cmi.credit': 'credit',
      'cmi.entry': 'ab-initio',
      'cmi.mode': el.mode.value.toLowerCase(),
      'cmi.location': '',
      'cmi.suspend_data': '',
    };
    var mastery = el.mastery.value.trim();
    if (mastery !== '') model['cmi.scaled_passing_score'] = mastery;
  }

  function installScorm12() {
    window.API_1484_11 = undefined;
    window.API = {
      LMSInitialize: function (p) { record('LMSInitialize', [p], 'true'); return 'true'; },
      LMSFinish: function (p) { record('LMSFinish', [p], 'true'); return 'true'; },
      LMSGetValue: function (key) {
        var value = key in model ? model[key] : '';
        record('LMSGetValue', [key], value);
        return value;
      },
      LMSSetValue: function (key, value) {
        model[key] = String(value);
        record('LMSSetValue', [key, value], 'true');
        renderModel();
        return 'true';
      },
      LMSCommit: function (p) { record('LMSCommit', [p], 'true'); return 'true'; },
      LMSGetLastError: function () { return '0'; },
      LMSGetErrorString: function () { return 'No error'; },
      LMSGetDiagnostic: function () { return ''; },
    };
  }

  function installScorm2004() {
    window.API = undefined;
    window.API_1484_11 = {
      Initialize: function (p) { record('Initialize', [p], 'true'); return 'true'; },
      Terminate: function (p) { record('Terminate', [p], 'true'); return 'true'; },
      GetValue: function (key) {
        var value = key in model ? model[key] : '';
        record('GetValue', [key], value);
        return value;
      },
      SetValue: function (key, value) {
        model[key] = String(value);
        record('SetValue', [key, value], 'true');
        renderModel();
        return 'true';
      },
      Commit: function (p) { record('Commit', [p], 'true'); return 'true'; },
      GetLastError: function () { return '0'; },
      GetErrorString: function () { return 'No error'; },
      GetDiagnostic: function () { return ''; },
    };
  }

  function clearScormApis() {
    window.API = undefined;
    window.API_1484_11 = undefined;
  }

  /* ---------------- xAPI and cmi5 launch ---------------- */

  function actor() {
    return {
      objectType: 'Agent',
      name: LEARNER.name,
      account: { homePage: window.location.origin, name: LEARNER.id },
    };
  }

  function uuid() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
      });
  }

  function absolute(path) {
    return new URL(path, window.location.origin).href;
  }

  function xapiUrl(pkg) {
    var params = new URLSearchParams({
      endpoint: absolute(LRS),
      // Rustici passes a complete header value, so the stub does too.
      auth: 'Basic ' + btoa('harness:harness'),
      actor: JSON.stringify(actor()),
      registration: current.registration,
      activity_id: 'https://example.com/harness/' + pkg,
    });
    return '/packages/' + encodeURIComponent(pkg) + '/index.html?' + params.toString();
  }

  /**
   * cmi5 requires the LMS to write LMS.LaunchData into the State API before it
   * launches the AU, and the AU then uses its contextTemplate verbatim. Getting
   * this wrong is the single most common reason a cmi5 course reports nothing,
   * so the harness does it exactly as the spec describes.
   */
  function prepareCmi5(pkg) {
    var activityId = 'https://example.com/harness/' + pkg;
    current.sessionId = uuid();

    var launchData = {
      contextTemplate: {
        contextActivities: {
          grouping: [{ id: activityId + '/publisher' }],
        },
        extensions: {
          'https://w3id.org/xapi/cmi5/context/extensions/sessionid': current.sessionId,
        },
      },
      launchMode: el.mode.value,
      moveOn: 'Completed',
      returnURL: absolute('/harness/?returned=1'),
    };
    var mastery = el.mastery.value.trim();
    if (mastery !== '') launchData.masteryScore = Number(mastery);

    var query = new URLSearchParams({
      activityId: activityId,
      agent: JSON.stringify(actor()),
      stateId: 'LMS.LaunchData',
      registration: current.registration,
    });

    return fetch(LRS + 'activities/state?' + query.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Experience-API-Version': '1.0.3' },
      body: JSON.stringify(launchData),
    }).then(function () {
      var params = new URLSearchParams({
        endpoint: absolute(LRS),
        fetch: absolute(LRS + 'token'),
        actor: JSON.stringify(actor()),
        registration: current.registration,
        activityId: activityId,
      });
      return '/packages/' + encodeURIComponent(pkg) + '/index.html?' + params.toString();
    });
  }

  function pollStatements() {
    if (statementTimer) clearInterval(statementTimer);
    statementTimer = setInterval(function () {
      fetch(LRS + 'statements')
        .then(function (r) { return r.json(); })
        .then(function (body) {
          var statements = body.statements || [];
          model = Object.create(null);
          statements.forEach(function (statement, index) {
            var verb = String(statement.verb && statement.verb.id || '').split('/').pop();
            var label = String(index + 1) + '. ' + verb;
            var parts = [];
            if (statement.result) {
              if (statement.result.completion !== undefined) {
                parts.push('completion=' + statement.result.completion);
              }
              if (statement.result.success !== undefined) {
                parts.push('success=' + statement.result.success);
              }
              if (statement.result.duration) parts.push(statement.result.duration);
              if (statement.result.score && statement.result.score.scaled !== undefined) {
                parts.push('scaled=' + statement.result.score.scaled);
              }
            }
            var categories = (statement.context && statement.context.contextActivities
              && statement.context.contextActivities.category) || [];
            var names = categories.map(function (c) {
              return String(c.id).split('/').pop();
            });
            if (names.length) parts.push('[' + names.join(' ') + ']');
            model[label] = parts.join(' ') || String(statement.object && statement.object.id || '');
          });
          renderModel();
          summariseStatements(statements);
        })
        .catch(function () { /* the stub is gone; nothing to show */ });
    }, 1000);
  }

  function summariseStatements(statements) {
    if (!statements.length) {
      setSummary('No statements recorded yet.');
      return;
    }
    var verbs = statements.map(function (s) {
      return String(s.verb && s.verb.id || '').split('/').pop();
    });
    var problems = [];

    if (current.standard === 'cmi5') {
      if (verbs[0] !== 'initialized') {
        problems.push('first statement is ' + verbs[0] + ', not initialized');
      }
      var missingSession = statements.filter(function (s) {
        var ext = (s.context && s.context.extensions) || {};
        return !ext['https://w3id.org/xapi/cmi5/context/extensions/sessionid'];
      });
      if (missingSession.length) {
        problems.push(missingSession.length + ' statement(s) missing the session id');
      }
      var judged = statements.filter(function (s) {
        return s.result && (s.result.completion !== undefined || s.result.success !== undefined);
      });
      var withoutMoveOn = judged.filter(function (s) {
        var cats = (s.context && s.context.contextActivities
          && s.context.contextActivities.category) || [];
        return !cats.some(function (c) { return /moveon$/.test(c.id); });
      });
      if (withoutMoveOn.length) {
        problems.push(withoutMoveOn.length + ' judged statement(s) missing the moveon category');
      }
    }

    var notUuid = statements.filter(function (s) {
      return !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.id || '');
    });
    if (notUuid.length) problems.push(notUuid.length + ' statement id(s) are not UUIDs');

    if (problems.length) {
      setSummary(statements.length + ' statements. Problems: ' + problems.join('; '), 'error');
    } else {
      setSummary(statements.length + ' statements: ' + verbs.join(', '), 'ok');
    }
  }

  /* ---------------- launch ---------------- */

  function detectStandard(pkg) {
    return fetch('/packages/' + encodeURIComponent(pkg) + '/content/pages.json')
      .then(function (r) { return r.json(); })
      .then(function (body) { return body.standard || 'scorm12'; })
      .catch(function () { return 'scorm12'; });
  }

  function resetAll() {
    calls = [];
    model = Object.create(null);
    if (statementTimer) { clearInterval(statementTimer); statementTimer = null; }
    renderCalls();
    renderModel();
    el.sco.hidden = true;
    el.sco.removeAttribute('src');
    el.placeholder.hidden = false;
    setSummary('Everything the fake LMS had stored has been forgotten.');
    return fetch(LRS + 'reset', { method: 'POST' }).catch(function () {});
  }

  function launch(options) {
    var pkg = el.package.value;
    if (!pkg) return;

    var startFresh = options && options.fresh;

    Promise.resolve()
      .then(function () { return startFresh ? resetAll() : null; })
      .then(function () {
        return el.standard.value === 'auto' ? detectStandard(pkg) : el.standard.value;
      })
      .then(function (standard) {
        current.pkg = pkg;
        current.standard = standard;
        if (startFresh || !current.registration) current.registration = uuid();
        syncControls();

        el.placeholder.hidden = true;
        el.sco.hidden = false;

        if (standard === 'scorm12') {
          if (startFresh) seedScorm12();
          installScorm12();
          renderModel();
          setSummary('SCORM 1.2 attempt running. Page through the course and watch the model.');
          el.sco.src = '/packages/' + encodeURIComponent(pkg) + '/index.html';
          return null;
        }

        if (standard === 'scorm2004') {
          if (startFresh) seedScorm2004();
          else model['cmi.mode'] = el.mode.value.toLowerCase();
          installScorm2004();
          renderModel();
          setSummary('SCORM 2004 attempt running in ' + el.mode.value + ' mode.');
          el.sco.src = '/packages/' + encodeURIComponent(pkg) + '/index.html';
          return null;
        }

        clearScormApis();
        pollStatements();

        if (standard === 'cmi5') {
          setSummary('cmi5 launch prepared; waiting for statements.');
          return prepareCmi5(pkg).then(function (url) { el.sco.src = url; });
        }

        setSummary('xAPI launch prepared; waiting for statements.');
        el.sco.src = xapiUrl(pkg);
        return null;
      })
      .catch(function (err) {
        setSummary('Could not launch: ' + err.message, 'error');
      });
  }
})();
