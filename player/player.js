/* Page-turner for a PDF converted to an e-learning package.
 *
 * Talks to the LMS through window.PdfScormAdapter, which the build step picks
 * per standard. The contract is:
 *
 *   adapter.label                       human-readable standard name
 *   adapter.init(manifest)  -> Promise<{
 *                                connected, learnerName, mode, state, error }>
 *                              state is whatever was handed to saveProgress
 *                              last time, or null on a first attempt.
 *                              mode is 'normal' | 'browse' | 'review';
 *                              anything but 'normal' must not record results.
 *   adapter.saveProgress(p) -> void     p = {page, totalPages, visited, percent}
 *   adapter.setComplete(i)  -> void     i = {percent, score}
 *   adapter.finish(i)       -> void     i = {seconds, page, percent, complete}
 *
 * Every method may throw or reject; the player treats the LMS as best-effort
 * and keeps working when it is absent, so the same package can be opened
 * straight from disk for review.
 */
(function () {
  'use strict';

  var SAVE_DEBOUNCE_MS = 1200;
  var ZOOM_MODES = ['page', 'width', 'actual'];
  var ZOOM_LABELS = { page: 'Fit page', width: 'Fit width', actual: 'Actual size' };

  var el = {};
  var manifest = null;
  var pages = [];
  var current = 1;
  var visited = Object.create(null);
  var visitedCount = 0;
  var zoom = 'page';
  var startedAt = Date.now();
  var completeSent = false;
  var finished = false;
  var saveTimer = null;
  var session = { connected: false, mode: 'normal', learnerName: '', state: null };

  var adapter = window.PdfScormAdapter || {
    label: 'no LMS',
    init: function () { return Promise.resolve({ connected: false }); },
    saveProgress: function () {},
    setComplete: function () {},
    finish: function () {},
  };

  document.addEventListener('DOMContentLoaded', function () {
    cacheElements();
    wireEvents();
    boot();
  });

  function cacheElements() {
    ['viewer', 'course-title', 'lms-status', 'thumbs', 'toggle-thumbs', 'stage',
     'page-figure', 'page-img', 'page-text', 'loading', 'prev', 'next',
     'page-input', 'page-total', 'progress', 'progress-fill', 'progress-label',
     'zoom-mode', 'fullscreen', 'toast'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
  }

  function boot() {
    fetch('content/pages.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        manifest = data;
        pages = data.pages || [];
        if (!pages.length) throw new Error('package contains no pages');

        document.title = data.title || 'Course';
        el['course-title'].textContent = data.title || 'Course';
        el['page-total'].textContent = String(pages.length);
        el['page-input'].max = String(pages.length);
        buildThumbs();
        return connect();
      })
      .then(function () {
        show(restoreStartPage(), { silent: true });
        el.loading.hidden = true;
        el.stage.focus({ preventScroll: true });
        if (completionRule() === 'launch') markComplete();
      })
      .catch(function (err) {
        el.loading.textContent = 'This course could not be loaded: ' + err.message;
        el.loading.hidden = false;
      });
  }

  function connect() {
    return Promise.resolve()
      .then(function () { return adapter.init(manifest); })
      .then(function (result) {
        session = Object.assign({ connected: false, mode: 'normal' }, result || {});
        setStatus(session.connected
          ? (session.mode === 'normal' ? 'Connected' : 'Connected (' + session.mode + ')')
          : 'Not connected', session.connected ? 'ok' : 'idle');
        if (session.error) setStatus(session.error, 'error');
      })
      .catch(function (err) {
        session = { connected: false, mode: 'normal' };
        setStatus('LMS unavailable', 'error');
        // Worth surfacing: a package that silently stops tracking looks fine to
        // the learner and shows nothing to whoever assigned the course.
        if (window.console) console.warn('LMS init failed:', err);
      });
  }

  /* ---------- restore ---------- */

  function restoreStartPage() {
    var state = session.state;
    if (!state) return 1;

    if (Array.isArray(state.visited)) {
      state.visited.forEach(function (n) {
        if (!visited[n] && n >= 1 && n <= pages.length) { visited[n] = true; visitedCount++; }
      });
      refreshThumbFlags();
    }
    var page = Number(state.page);
    if (page >= 1 && page <= pages.length) {
      if (page > 1) toast('Resumed on page ' + page);
      return page;
    }
    return 1;
  }

  /* ---------- rendering ---------- */

  function buildThumbs() {
    var frag = document.createDocumentFragment();
    pages.forEach(function (page) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb';
      btn.dataset.page = String(page.n);
      btn.innerHTML = '<img alt="" loading="lazy"><span class="thumb__n"></span>';
      btn.querySelector('img').src = 'content/' + page.src;
      btn.querySelector('.thumb__n').textContent = String(page.n);
      btn.setAttribute('aria-label', 'Go to page ' + page.n);
      frag.appendChild(btn);
    });
    el.thumbs.appendChild(frag);
  }

  function show(n, options) {
    var opts = options || {};
    n = Math.min(Math.max(1, Number(n) || 1), pages.length);
    var page = pages[n - 1];
    current = n;

    el['page-img'].src = 'content/' + page.src;
    el['page-img'].width = Math.round(page.w);
    el['page-img'].height = Math.round(page.h);
    // The image *is* the content, so its accessible name has to say which page
    // this is; the transcribed text sits in the figcaption next to it.
    el['page-img'].alt = 'Page ' + n + ' of ' + pages.length;
    el['page-text'].textContent = page.text || '';

    el['page-input'].value = String(n);
    el.prev.disabled = n === 1;
    el.next.disabled = n === pages.length;
    el.stage.scrollTop = 0;

    if (!visited[n]) { visited[n] = true; visitedCount++; }
    refreshThumbFlags();
    updateProgress();

    if (!opts.silent) queueSave();
    else scheduleSave(0);

    if (!completeSent && completionMet()) markComplete();
  }

  function refreshThumbFlags() {
    var nodes = el.thumbs.querySelectorAll('.thumb');
    for (var i = 0; i < nodes.length; i++) {
      var n = Number(nodes[i].dataset.page);
      nodes[i].dataset.seen = visited[n] ? 'true' : 'false';
      if (n === current) {
        nodes[i].setAttribute('aria-current', 'true');
        if (!el.thumbs.hidden) nodes[i].scrollIntoView({ block: 'nearest' });
      } else {
        nodes[i].removeAttribute('aria-current');
      }
    }
  }

  function updateProgress() {
    var pct = percent();
    el['progress-fill'].style.width = pct + '%';
    el.progress.setAttribute('aria-valuenow', String(pct));
    el['progress-label'].textContent = pct + '% viewed';
  }

  function percent() {
    return pages.length ? Math.round((visitedCount / pages.length) * 100) : 0;
  }

  /* ---------- completion ---------- */

  function completionRule() {
    return (manifest.completion && manifest.completion.rule) || 'all';
  }

  function completionMet() {
    var rule = completionRule();
    if (rule === 'launch') return true;
    if (rule === 'percent') {
      var threshold = Number(manifest.completion.threshold) || 100;
      return percent() >= threshold;
    }
    return visitedCount >= pages.length;
  }

  function markComplete() {
    if (completeSent) return;
    completeSent = true;
    // Browse and Review launches are explicitly barred from recording results.
    if (session.mode !== 'normal') return;

    try {
      adapter.setComplete({ percent: percent(), score: scoreForCompletion() });
      toast('Course marked complete');
    } catch (err) {
      if (window.console) console.warn('setComplete failed:', err);
    }
  }

  function scoreForCompletion() {
    // A page-turner has nothing to grade. A score is only reported when the
    // package was built with a mastery score, in which case "read it all"
    // is the pass condition and the score is the proportion seen.
    if (manifest.masteryScore == null) return null;
    return percent() / 100;
  }

  /* ---------- persistence ---------- */

  function queueSave() { scheduleSave(SAVE_DEBOUNCE_MS); }

  function scheduleSave(delay) {
    if (session.mode !== 'normal') return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; saveNow(); }, delay);
  }

  function saveNow() {
    try {
      adapter.saveProgress({
        page: current,
        totalPages: pages.length,
        visited: visitedPages(),
        percent: percent(),
      });
    } catch (err) {
      if (window.console) console.warn('saveProgress failed:', err);
    }
  }

  function visitedPages() {
    var out = [];
    for (var n = 1; n <= pages.length; n++) if (visited[n]) out.push(n);
    return out;
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      if (session.mode === 'normal') saveNow();
      adapter.finish({
        seconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
        page: current,
        percent: percent(),
        complete: completeSent,
      });
    } catch (err) {
      if (window.console) console.warn('finish failed:', err);
    }
  }

  /* ---------- interaction ---------- */

  function wireEvents() {
    el.prev.addEventListener('click', function () { show(current - 1); });
    el.next.addEventListener('click', function () { show(current + 1); });

    el['page-input'].addEventListener('change', function () { show(el['page-input'].value); });

    el.thumbs.addEventListener('click', function (event) {
      var btn = event.target.closest('.thumb');
      if (btn) show(btn.dataset.page);
    });

    el['toggle-thumbs'].addEventListener('click', function () {
      var open = el.thumbs.hidden;
      el.thumbs.hidden = !open;
      el['toggle-thumbs'].setAttribute('aria-expanded', String(open));
      if (open) refreshThumbFlags();
    });

    el['zoom-mode'].addEventListener('click', function () {
      zoom = ZOOM_MODES[(ZOOM_MODES.indexOf(zoom) + 1) % ZOOM_MODES.length];
      el.stage.dataset.zoom = zoom;
      el['zoom-mode'].title = ZOOM_LABELS[zoom];
      toast(ZOOM_LABELS[zoom]);
    });

    el.fullscreen.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.viewer.requestFullscreen) el.viewer.requestFullscreen();
      else toast('Full screen is not available here');
    });

    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      // Never steal keys from the page-number box.
      if (event.target && event.target.tagName === 'INPUT') return;

      switch (event.key) {
        case 'ArrowRight': case 'PageDown': case ' ': show(current + 1); break;
        case 'ArrowLeft': case 'PageUp': show(current - 1); break;
        case 'Home': show(1); break;
        case 'End': show(pages.length); break;
        default: return;
      }
      event.preventDefault();
    });

    el.stage.dataset.zoom = zoom;
    el['zoom-mode'].title = ZOOM_LABELS[zoom];

    // pagehide is the one that fires reliably when an LMS swaps the iframe or
    // the learner closes the tab; beforeunload covers older desktop browsers.
    window.addEventListener('pagehide', finish);
    window.addEventListener('beforeunload', finish);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && !finished) saveNow();
    });
  }

  /* ---------- chrome ---------- */

  function setStatus(text, state) {
    el['lms-status'].textContent = text;
    el['lms-status'].dataset.state = state || 'idle';
  }

  var toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2600);
  }
})();
