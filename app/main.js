// Converter UI.

import { renderPdf, peek } from './pdf-render.js';
import { buildPackage, bundle } from './package-builder.js';

const el = (id) => document.getElementById(id);

const ui = {
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

// The File is kept rather than its bytes: pdf.js transfers the ArrayBuffer it
// is handed to its worker, which detaches it. Re-reading the File keeps a
// second build from failing on a dead buffer.
let pdfFile = null;
let built = [];
let objectUrls = [];
let busy = false;

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

async function accept(file) {
  const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksLikePdf) {
    fail(`${file.name} does not look like a PDF.`);
    return;
  }

  clearError();
  pdfFile = file;
  built = [];
  ui.results.hidden = true;
  ui.previewCard.hidden = true;
  ui.preview.replaceChildren();

  const stem = file.name.replace(/\.pdf$/i, '');
  ui.filemeta.hidden = false;
  ui.filemeta.textContent = `${file.name} — ${formatBytes(file.size)}, reading…`;

  try {
    const info = await peek(await file.arrayBuffer());
    ui.filemeta.textContent =
      `${file.name} — ${formatBytes(file.size)}, ${info.numPages} ` +
      `${info.numPages === 1 ? 'page' : 'pages'}`;

    if (!ui.title.value) ui.title.value = info.title || stem;
    if (!ui.description.value && info.subject) ui.description.value = info.subject;
    ui.build.disabled = false;
  } catch (err) {
    pdfFile = null;
    ui.build.disabled = true;
    ui.filemeta.textContent = `${file.name} — ${formatBytes(file.size)}`;
    fail(`This PDF could not be opened: ${err.message}. ` +
         'A password-protected or corrupt file will fail here.');
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
}

function selectedStandards() {
  return Array.from(ui.standards.querySelectorAll('input[type="checkbox"]:checked'))
    .map((box) => box.value);
}

function settings() {
  const masteryPercent = ui.mastery.value.trim();
  const parsedMastery = masteryPercent === '' ? null : Number(masteryPercent);

  return {
    title: ui.title.value.trim() || 'Course',
    description: ui.description.value.trim(),
    identifier: ui.identifier.value.trim(),
    language: ui.language.value.trim() || 'en',
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
  };
}

/* ---------- build ---------- */

ui.build.addEventListener('click', run);

async function run() {
  if (busy || !pdfFile) return;

  const standards = selectedStandards();
  if (!standards.length) {
    fail('Pick at least one standard to build.');
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

    setProgress(0, 'Reading the PDF…');
    const bytes = await pdfFile.arrayBuffer();

    const render = await renderPdf(bytes, options, (done, total) => {
      setProgress((done / total) * RENDER_SHARE, `Rendering page ${done} of ${total}…`);
    });

    if (!options.title || options.title === 'Course') {
      options.title = render.title || options.title;
    }

    showPreview(render);

    for (let i = 0; i < standards.length; i++) {
      const id = standards[i];
      setProgress(
        RENDER_SHARE + ((i / standards.length) * (1 - RENDER_SHARE)),
        `Packaging ${id}…`,
      );
      built.push(await buildPackage(render, options, id));
    }

    setProgress(1, `Done — ${built.length} ${built.length === 1 ? 'package' : 'packages'} built.`);
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
    caption.textContent = `+${render.pages.length - shown.length} more`;
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
    button.textContent = 'Download';
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
      fail(`Could not bundle the packages: ${err.message}`);
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

syncStandardOptions();
