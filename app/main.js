// Converter UI.

import { renderPdf, peek } from './pdf-render.js';
import { buildPackage, bundle } from './package-builder.js';
import { LANGUAGES, uiStrings, fill } from './i18n.js';

const el = (id) => document.getElementById(id);

const ui = {
  uiLanguage: el('ui-language'),
  drop: el('drop'),
  file: el('file'),
  filemeta: el('filemeta'),
  title: el('title'),
  description: el('description'),
  identifier: el('identifier'),
  language: el('language'),
  activityIri: el('activity-iri'),
  standards: el('standards'),
  completionRule: el('completion-rule'),
  thresholdField: el('threshold-field'),
  threshold: el('completion-threshold'),
  mastery: el('mastery'),
  moveOn: el('moveon'),
  moveOnField: el('moveon-field'),
  perPage: el('per-page'),
  perPageRow: el('per-page-row'),
  dpi: el('dpi'),
  format: el('format'),
  quality: el('quality'),
  qualityOut: el('quality-out'),
  extractText: el('extract-text'),
  includeSchemas: el('include-schemas'),
  schemasRow: el('schemas-row'),
  build: el('build'),
  progress: el('progress'),
  progressFill: el('progress-fill'),
  progressLabel: el('progress-label'),
  error: el('error'),
  results: el('results'),
  resultsList: el('results-list'),
  downloadAll: el('download-all'),
  previewCard: el('preview-card'),
  preview: el('preview'),
};

const LANGUAGE_KEY = 'pdf-to-scorm.uiLanguage';

// The File is kept rather than its bytes: pdf.js transfers the ArrayBuffer it
// is handed to its worker, which detaches it. Re-reading the File keeps a
// second build from failing on a dead buffer.
let pdfFile = null;
let pdfInfo = null;
let strings = uiStrings('en');
let built = [];
let objectUrls = [];
let busy = false;
// Set once the author picks a course language by hand, after which the
// interface language stops dragging it along.
let courseLanguagePinned = false;

const t = (key, values) => fill(strings[key], values);

/* ---------- language ---------- */

function storedLanguage() {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) || '';
  } catch {
    // Private windows and locked-down browsers throw on access rather than
    // returning null, so this can never be left unguarded.
    return '';
  }
}

function rememberLanguage(code) {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, code);
  } catch {
    /* a remembered preference is a convenience, not a requirement */
  }
}

function initLanguages() {
  for (const select of [ui.uiLanguage, ui.language]) {
    select.replaceChildren();
    for (const language of LANGUAGES) {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = language.label;
      select.appendChild(option);
    }
  }

  const initial = LANGUAGES.some((l) => l.code === storedLanguage())
    ? storedLanguage()
    : (LANGUAGES.find((l) => navigator.language.toLowerCase().startsWith(l.code))?.code || 'en');

  ui.uiLanguage.value = initial;
  // The course defaults to the language of the interface, which is right far
  // more often than not.
  ui.language.value = initial;

  // ...and keeps following it until the author says otherwise. Without this,
  // switching the interface to Czech left the course language on English and
  // silently produced a course with English buttons -- a trap, because nothing
  // on screen contradicted the choice that had just been made.
  ui.language.addEventListener('change', () => { courseLanguagePinned = true; });

  ui.uiLanguage.addEventListener('change', () => {
    rememberLanguage(ui.uiLanguage.value);
    if (!courseLanguagePinned) ui.language.value = ui.uiLanguage.value;
    applyLanguage();
  });
  applyLanguage();
}

function applyLanguage() {
  const code = ui.uiLanguage.value;
  strings = uiStrings(code);
  document.documentElement.lang = code;

  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = strings[node.dataset.i18n];
    if (value) node.textContent = value;
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    const value = strings[node.dataset.i18nPlaceholder];
    if (value) node.placeholder = value;
  }

  // Text built at runtime is not covered by the attribute sweep.
  if (pdfFile && pdfInfo) describeFile(pdfFile, pdfInfo);
  ui.uiLanguage.setAttribute('aria-label', t('app.language'));
}

/* ---------- intake ---------- */

ui.drop.addEventListener('click', () => ui.file.click());
ui.drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    ui.file.click();
  }
});

['dragenter', 'dragover'].forEach((type) => {
  ui.drop.addEventListener(type, (event) => {
    event.preventDefault();
    ui.drop.dataset.over = 'true';
  });
});
['dragleave', 'drop'].forEach((type) => {
  ui.drop.addEventListener(type, () => { ui.drop.dataset.over = 'false'; });
});

ui.drop.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) accept(file);
});

ui.file.addEventListener('change', () => {
  if (ui.file.files[0]) accept(ui.file.files[0]);
});

function describeFile(file, info) {
  const count = info.numPages;
  const unit = t(count === 1 ? 'source.page' : 'source.pages');
  ui.filemeta.textContent = `${file.name} — ${formatBytes(file.size)}, ${count} ${unit}`;
}

async function accept(file) {
  const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksLikePdf) {
    fail(t('source.notPdf', { name: file.name }));
    return;
  }

  clearError();
  pdfFile = file;
  pdfInfo = null;
  built = [];
  ui.results.hidden = true;
  ui.previewCard.hidden = true;
  ui.preview.replaceChildren();

  const stem = file.name.replace(/\.pdf$/i, '');
  ui.filemeta.hidden = false;
  ui.filemeta.textContent = `${file.name} — ${formatBytes(file.size)}, ${t('source.reading')}`;

  try {
    const info = await peek(await file.arrayBuffer());
    pdfInfo = info;
    describeFile(file, info);

    if (!ui.title.value) ui.title.value = info.title || stem;
    if (!ui.description.value && info.subject) ui.description.value = info.subject;
    ui.build.disabled = false;
  } catch (err) {
    pdfFile = null;
    pdfInfo = null;
    ui.build.disabled = true;
    ui.filemeta.textContent = `${file.name} — ${formatBytes(file.size)}`;
    fail(t('source.openFailed', { message: err.message }));
  }
}

/* ---------- option plumbing ---------- */

ui.quality.addEventListener('input', () => { ui.qualityOut.value = ui.quality.value; });

ui.completionRule.addEventListener('change', () => {
  ui.thresholdField.hidden = ui.completionRule.value !== 'percent';
});

// Options that only mean something for one standard are hidden when that
// standard is not being built, so the form does not ask questions that have no
// bearing on the output.
ui.standards.addEventListener('change', syncStandardOptions);

function syncStandardOptions() {
  const chosen = selectedStandards();
  ui.moveOnField.hidden = !chosen.includes('cmi5');
  ui.perPageRow.hidden = !chosen.includes('xapi');
  // Only the two SCORM standards have schemas to ship.
  ui.schemasRow.hidden = !chosen.some((id) => id.startsWith('scorm'));
}

function selectedStandards() {
  return Array.from(ui.standards.querySelectorAll('input[type="checkbox"]:checked'))
    .map((box) => box.value);
}

function settings() {
  const masteryPercent = ui.mastery.value.trim();
  const parsedMastery = masteryPercent === '' ? null : Number(masteryPercent);

  return {
    title: ui.title.value.trim() || t('course.fallbackTitle'),
    description: ui.description.value.trim(),
    identifier: ui.identifier.value.trim(),
    language: ui.language.value,
    activityIri: ui.activityIri.value.trim(),
    completionRule: ui.completionRule.value,
    completionThreshold: Number(ui.threshold.value) || 80,
    // The UI asks for a percentage because that is how people think about a
    // pass mark; every standard except SCORM 1.2 wants a 0-1 scaled value, so
    // it is normalised once, here.
    masteryScore: parsedMastery == null || !isFinite(parsedMastery)
      ? null
      : Math.min(1, Math.max(0, parsedMastery / 100)),
    moveOn: ui.moveOn.value,
    perPageStatements: ui.perPage.checked,
    dpi: Number(ui.dpi.value),
    format: ui.format.value,
    quality: Number(ui.quality.value) / 100,
    extractText: ui.extractText.checked,
    includeSchemas: ui.includeSchemas.checked,
  };
}

/* ---------- build ---------- */

ui.build.addEventListener('click', run);

async function run() {
  if (busy || !pdfFile) return;

  const standards = selectedStandards();
  if (!standards.length) {
    fail(t('build.noStandards'));
    return;
  }

  busy = true;
  ui.build.disabled = true;
  clearError();
  releaseUrls();
  built = [];
  ui.results.hidden = true;
  ui.resultsList.replaceChildren();
  ui.progress.hidden = false;

  const options = settings();

  try {
    // Rendering dominates the wall clock, so it gets most of the bar.
    const RENDER_SHARE = 0.75;

    setProgress(0, t('build.reading'));
    const bytes = await pdfFile.arrayBuffer();

    const render = await renderPdf(bytes, options, (done, total) => {
      setProgress((done / total) * RENDER_SHARE, t('build.rendering', { done, total }));
    });

    if (render.title && !ui.title.value.trim()) options.title = render.title;

    showPreview(render);

    for (let i = 0; i < standards.length; i++) {
      const id = standards[i];
      setProgress(
        RENDER_SHARE + ((i / standards.length) * (1 - RENDER_SHARE)),
        t('build.packaging', { standard: id }),
      );
      built.push(await buildPackage(render, options, id));
    }

    setProgress(1, t('build.done', { count: built.length }));
    showResults(options);
  } catch (err) {
    ui.progress.hidden = true;
    fail(err && err.message ? err.message : String(err));
    if (window.console) console.error(err);
  } finally {
    busy = false;
    ui.build.disabled = false;
  }
}

function setProgress(fraction, label) {
  ui.progressFill.style.width = `${Math.round(fraction * 100)}%`;
  ui.progressLabel.textContent = label;
}

function showPreview(render) {
  const frag = document.createDocumentFragment();
  // A long document would otherwise put hundreds of full-size bitmaps on the
  // page purely as decoration.
  const shown = render.pages.slice(0, 24);

  shown.forEach((page) => {
    const url = URL.createObjectURL(page.blob);
    objectUrls.push(url);

    const figure = document.createElement('figure');
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    const caption = document.createElement('figcaption');
    caption.textContent = String(page.pageNumber);
    figure.append(img, caption);
    frag.appendChild(figure);
  });

  if (render.pages.length > shown.length) {
    const note = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = t('build.more', { count: render.pages.length - shown.length });
    note.appendChild(caption);
    frag.appendChild(note);
  }

  ui.preview.replaceChildren(frag);
  ui.previewCard.hidden = false;
}

function showResults(options) {
  const frag = document.createDocumentFragment();

  built.forEach((pkg) => {
    const item = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'results__name';
    name.textContent = pkg.label;

    const size = document.createElement('span');
    size.className = 'results__size';
    size.textContent = formatBytes(pkg.bytes);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dl';
    button.textContent = t('build.download');
    button.addEventListener('click', () => save(pkg.blob, pkg.filename));

    item.append(name, size, button);
    frag.appendChild(item);
  });

  ui.resultsList.replaceChildren(frag);
  ui.results.hidden = false;

  // Browsers block a burst of automatic downloads, so several packages get one
  // combined zip rather than one click each.
  ui.downloadAll.hidden = built.length < 2;
  ui.downloadAll.onclick = async () => {
    ui.downloadAll.disabled = true;
    try {
      const all = await bundle(built, options.identifier || options.title);
      save(all.blob, all.filename);
    } catch (err) {
      fail(t('build.bundleFailed', { message: err.message }));
    } finally {
      ui.downloadAll.disabled = false;
    }
  };
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------- odds and ends ---------- */

function releaseUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}

function fail(message) {
  ui.error.hidden = false;
  ui.error.textContent = message;
}

function clearError() {
  ui.error.hidden = true;
  ui.error.textContent = '';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

initLanguages();
syncStandardOptions();
