/* Page-turner for a PDF converted to an e-learning package.
 *
 * Talks to the LMS through window.PdfScormAdapter, which the build step picks
 * per standard. The contract is:
 *
 *   adapter.label                       human-readable standard name
 *   adapter.init(manifest)  -> Promise<{
 *                                connected, learnerName, mode, state,
 *                                returnUrl, error }>
 *                              state is whatever was handed to saveProgress
 *                              last time, or null on a first attempt.
 *                              mode is 'normal' | 'browse' | 'review';
 *                              anything but 'normal' must not record results.
 *                              returnUrl, when present, is a link back to the
 *                              LMS (cmi5 supplies one in its launch data).
 *   adapter.saveProgress(p) -> void     p = {page, totalPages, visited, percent}
 *   adapter.setComplete(i)  -> void     i = {percent, score}
 *   adapter.finish(i)       -> void     i = {seconds, page, percent, complete}
 *
 * Every method may throw or reject; the player treats the LMS as best-effort
 * and keeps working when it is absent, so the same package can be opened
 * straight from disk for review.
 *
 * Interface text comes from content/pages.json, resolved for the course
 * language at build time. English is compiled in as a fallback so a package
 * built by an older version still has labelled buttons.
 */
(function () {
  'use strict';

  var SAVE_DEBOUNCE_MS = 1200;
  var ZOOM_MODES = ['page', 'width', 'actual'];
  var ZOOM_LABEL_KEYS = { page: 'fitPage', width: 'fitWidth', actual: 'actualSize' };

  var FALLBACK = {
    previous: 'Previous', next: 'Next', pageNumber: 'Page number',
    pageOf: 'Page {n} of {total}', goToPage: 'Go to page {n}',
    viewed: '{percent}% viewed', pagesViewed: 'Pages viewed',
    thumbnails: 'Show page thumbnails', pages: 'Pages', pageContent: 'Page content',
    fitPage: 'Fit page', fitWidth: 'Fit width', actualSize: 'Actual size',
    changeZoom: 'Change zoom', fullscreen: 'Full screen',
    fullscreenUnavailable: 'Full screen is not available here',
    connected: 'Connected', connectedMode: 'Connected ({mode})',
    notConnected: 'Not connected', lmsUnavailable: 'LMS unavailable',
    loading: 'Loading…', loadFailed: 'This course could not be loaded: {message}',
    resumed: 'Resumed on page {n}', markedComplete: 'Course marked complete',
    returnToLms: 'Return to the LMS', course: 'Course'
  };

  var el = {};
  var strings = FALLBACK;
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

  function t(key, values) {
    var template = strings[key] || FALLBACK[key] || '';
    return template.replace(/\{(\w+)\}/g, function (whole, name) {
      return values && name in values ? String(values[name]) : whole;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    cacheElements();
    applyStrings();
    wireEvents();
    boot();
  });

  function cacheElements() {
    ['viewer', 'course-title', 'lms-status', 'thumbs', 'toggle-thumbs',
     'toggle-thumbs-label', 'stage', 'page-figure', 'page-img', 'page-text',
     'loading', 'prev', 'prev-label', 'next', 'next-label', 'page-input',
     'page-input-label', 'page-total', 'progress', 'progress-fill',
     'progress-label', 'zoom-mode', 'zoom-mode-label', 'fullscreen',
     'fullscreen-label', 'return-lms', 'toast'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
  }

  function applyStrings() {
    el.loading.textContent = t('loading');
    el['prev-label'].textContent = t('previous');
    el['next-label'].textContent = t('next');
    el.prev.setAttribute('aria-label', t('previous'));
    el.next.setAttribute('aria-label', t('next'));
    el['page-input-label'].textContent = t('pageNumber');
    el['toggle-thumbs-label'].textContent = t('thumbnails');
    el['toggle-thumbs'].title = t('thumbnails');
    el.thumbs.setAttribute('aria-label', t('pages'));
    el.stage.setAttribute('aria-label', t('pageContent'));
    el.progress.setAttribute('aria-label', t('pagesViewed'));
    el['zoom-mode-label'].textContent = t('changeZoom');
    el['fullscreen-label'].textContent = t('fullscreen');
    el.fullscreen.title = t('fullscreen');
    el['return-lms'].textContent = t('returnToLms');
    el['zoom-mode'].title = t(ZOOM_LABEL_KEYS[zoom]);
  }

  /**
   * The course manifest.
   *
   * Taken from the inline block the build step writes, and only fetched if that
   * is missing. The order matters: a package unzipped and opened by
   * double-click runs from file://, where a page cannot fetch its own siblings
   * -- the fetch fails with "Failed to fetch" and the course never loads, which
   * is exactly what someone checking a package before uploading it would hit.
   * The fetch stays as the fallback for anything that rewrites index.html.
   */
  function loadManifest() {
    var inline = document.getElementById('course-data');
    if (inline && inline.textContent) {
      try {
        var parsed = JSON.parse(inline.textContent);
        if (parsed && parsed.pages && parsed.pages.length) {
          return Promise.resolve(parsed);
        }
      } catch (err) {
        // A malformed block should not be fatal while a real file sits next to
        // it, so fall through rather than give up.
      }
    }
    return fetch('content/pages.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function boot() {
    loadManifest()
      .then(function (data) {
        manifest = data;
        pages = data.pages || [];
        if (data.ui) {
          // Merged over the fallback so a missing key can never blank a label.
          strings = Object.assign({}, FALLBACK, data.ui);
          applyStrings();
        }
        if (data.language) document.documentElement.lang = data.language;
        if (!pages.length) throw new Error('package contains no pages');

        document.title = data.title || t('course');
        el['course-title'].textContent = data.title || t('course');
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
        el.loading.textContent = t('loadFailed', { message: err.message });
        el.loading.hidden = false;
      });
  }

  function connect() {
    return Promise.resolve()
      .then(function () { return adapter.init(manifest); })
      .then(function (result) {
        session = Object.assign({ connected: false, mode: 'normal' }, result || {});

        if (session.connected) {
          setStatus(session.mode === 'normal'
            ? t('connected')
            : t('connectedMode', { mode: session.mode }), 'ok');
        } else {
          // A learner reads this line, so it says what it means for them rather
          // than naming the API that was missing. The technical reason goes to
          // the console for whoever is debugging the package.
          setStatus(t('notConnected'), 'error');
          if (session.error && window.console) {
            console.warn('LMS not connected:', session.error);
          }
        }

        // cmi5 hands the AU a URL to send the learner back to; other standards
        // leave the LMS in charge of its own chrome, so there is nothing to show.
        if (session.returnUrl) el['return-lms'].hidden = false;
      })
      .catch(function (err) {
        session = { connected: false, mode: 'normal' };
        setStatus(t('lmsUnavailable'), 'error');
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
      if (page > 1) toast(t('resumed', { n: page }));
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
      btn.setAttribute('aria-label', t('goToPage', { n: page.n }));
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
    el['page-img'].alt = t('pageOf', { n: n, total: pages.length });
    el['page-text'].textContent = page.text || '';

    el['page-input'].value = String(n);
    el.prev.disabled = n === 1;
    el.next.disabled = n === pages.length;
    el.stage.scrollTop = 0;

    if (!visited[n]) { visited[n] = true; visitedCount++; }
    refreshThumbFlags();
    updateProgress();

    if (!completeSent && completionMet()) {
      // Flush first: otherwise the debounced save lands after the completion
      // statement and the record reads out of order.
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      saveNow();
      markComplete();
    } else if (opts.silent) {
      scheduleSave(0);
    } else {
      queueSave();
    }
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
    el['progress-label'].textContent = t('viewed', { percent: pct });
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
      toast(t('markedComplete'));
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
      el['zoom-mode'].title = t(ZOOM_LABEL_KEYS[zoom]);
      toast(t(ZOOM_LABEL_KEYS[zoom]));
    });

    el.fullscreen.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.viewer.requestFullscreen) el.viewer.requestFullscreen();
      else toast(t('fullscreenUnavailable'));
    });

    el['return-lms'].addEventListener('click', function () {
      // Close the session explicitly rather than relying on pagehide firing
      // before navigation: the Terminated statement has to be recorded.
      finish();
      window.location.href = session.returnUrl;
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
