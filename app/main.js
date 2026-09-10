// Converter UI.
//
// One PDF or many: every file dropped becomes a course entry, and the entry --
// not the form -- is where a course's title and language live. With one file
// the Settings fields mirror that entry, so nothing looks different; with
// several, each row in the list carries its own, because one form cannot hold
// five titles. Either way the values were worked out from the document first
// (see app/derive.js) and are only overridden by a person, never guessed twice.

import { renderPdf, peek } from './pdf-render.js';
import { buildPackage, bundle } from './package-builder.js';
import { LANGUAGES, uiStrings, fill } from './i18n.js';
import { courseLanguage, courseTitle, failureKey } from './derive.js';
import { id as safeId } from './standards/xml.js';
import { BY_ID } from './standards/index.js';

const el = (id) => document.getElementById(id);

const ui = {
  uiLanguage: el('ui-language'),
  drop: el('drop'),
  file: el('file'),
  filemeta: el('filemeta'),
  notices: el('notices'),
  queue: el('queue'),
  title: el('title'),
  description: el('description'),
  identifier: el('identifier'),
  language: el('language'),
  activityIri: el('activity-iri'),
  courseFields: el('course-fields'),
  bulkNote: el('bulk-note'),
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
  downloadFormats: el('download-formats'),
  previewCard: el('preview-card'),
  preview: el('preview'),
};

const LANGUAGE_KEY = 'pdf-to-scorm.uiLanguage';

/**
 * The courses in hand, one per PDF.
 *
 * Each keeps its File rather than its bytes: pdf.js transfers the ArrayBuffer
 * it is handed to its worker, which detaches it, so a second build would fail
 * on a dead buffer. Re-reading the File is cheap and safe.
 *
 * @type {Array<{
 *   id: number, file: File, info: object|null, title: string,
 *   description: string, language: string,
 *   notices: Array<{key: string, values?: object}>, error: string,
 *   status: 'reading'|'ready'|'failed', built: Array<object>,
 * }>}
 */
let courses = [];
let nextId = 1;
let strings = uiStrings('en');
let objectUrls = [];
let busy = false;
// Set once the author picks a course language by hand, after which neither the
// interface language nor a document's own /Lang moves it.
let courseLanguagePinned = false;

const t = (key, values) => fill(strings[key], values);

/** A count with its noun, declined for the interface language. */
function counted(count, noun) {
  const form = new Intl.PluralRules(ui.uiLanguage.value).select(count);
  return `${count} ${t(`${noun}.${form}`) || t(`${noun}.other`)}`;
}

const single = () => courses.length === 1;
const ready = () => courses.filter((c) => c.status === 'ready');

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

function languageOptions(select) {
  select.replaceChildren();
  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.label;
    select.appendChild(option);
  }
}

function initLanguages() {
  languageOptions(ui.uiLanguage);
  languageOptions(ui.language);

  const initial = LANGUAGES.some((l) => l.code === storedLanguage())
    ? storedLanguage()
    : (LANGUAGES.find((l) => navigator.language.toLowerCase().startsWith(l.code))?.code || 'en');

  ui.uiLanguage.value = initial;
  // The course defaults to the language of the interface, which is right far
  // more often than not -- until the document says otherwise, or the author.
  ui.language.value = initial;

  // A hand-picked course language is final. Without this, switching the
  // interface to Czech left the course on English and silently produced a
  // course with English buttons -- a trap, because nothing on screen
  // contradicted the choice that had just been made.
  ui.language.addEventListener('change', () => {
    courseLanguagePinned = true;
    if (single()) courses[0].language = ui.language.value;
  });

  ui.uiLanguage.addEventListener('change', () => {
    rememberLanguage(ui.uiLanguage.value);
    if (!courseLanguagePinned) {
      ui.language.value = ui.uiLanguage.value;
      // Courses that took their language from the interface follow it; ones
      // that took it from their own document do not.
      for (const course of courses) {
        if (!course.languageFromPdf) course.language = ui.uiLanguage.value;
      }
    }
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
  refreshIntake();
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
  accept(event.dataTransfer.files);
});

ui.file.addEventListener('change', () => {
  accept(ui.file.files);
  // Otherwise picking the same file again is silently ignored.
  ui.file.value = '';
});

/**
 * Takes in whatever was dropped: one PDF or a folder's worth.
 *
 * Files are read one after another rather than all at once. pdf.js holds each
 * document in memory while it is open, and twenty PDFs opened together is how
 * a browser tab dies; one at a time is bounded and still fast.
 */
async function accept(fileList) {
  const files = Array.from(fileList || []);
  const pdfs = files.filter(
    (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
  );
  const skipped = files.filter((file) => !pdfs.includes(file));

  clearError();
  if (skipped.length) {
    fail(t('source.notPdf', { name: skipped.map((f) => f.name).join(', ') }));
  }
  if (!pdfs.length) return;

  // A build in hand belongs to the previous set of files.
  releaseUrls();
  ui.results.hidden = true;
  ui.resultsList.replaceChildren();
  ui.previewCard.hidden = true;
  ui.preview.replaceChildren();
  for (const course of courses) course.built = [];

  const entries = pdfs.map((file) => ({
    id: nextId++,
    file,
    info: null,
    title: '',
    description: '',
    language: ui.language.value,
    languageFromPdf: false,
    notices: [],
    error: '',
    status: 'reading',
    built: [],
  }));
  courses.push(...entries);
  refreshIntake();

  for (const entry of entries) {
    await intake(entry);
    refreshIntake();
  }
}

/** Reads one PDF and works out what the course should be. */
async function intake(entry) {
  try {
    const info = await peek(await entry.file.arrayBuffer());
    entry.info = info;
    adoptFromPdf(entry);
    entry.status = 'ready';
  } catch (err) {
    entry.status = 'failed';
    entry.error = describeFailure(err);
  }
}

/** Turns what pdf.js reported into a sentence someone can act on. */
function describeFailure(err) {
  const key = failureKey(err);
  return key
    ? t(key)
    : t('source.openFailed', { message: (err && err.message) || String(err) });
}

/**
 * Takes the course settings from the PDF, and records what it took.
 *
 * This is the whole point of the automatic path: nobody should have to open a
 * PDF to find out whether it carries a title, or check afterwards that the
 * course did not end up named after a file. The notices are stored as keys, not
 * sentences, so they re-render when the interface language changes.
 */
function adoptFromPdf(entry) {
  const { file, info } = entry;
  entry.notices = [];

  const picked = courseTitle({
    metaTitle: info.title,
    heading: info.heading,
    filename: file.name,
  });
  entry.title = picked.title;
  // A title straight out of the metadata needs no explaining: it is what the
  // document says it is called. The other two were worked out, so they are
  // reported.
  if (picked.source === 'page') {
    entry.notices.push({ key: 'notice.titleFromPage', values: { title: picked.title } });
  } else if (picked.source === 'filename') {
    entry.notices.push({ key: 'notice.titleFromFile', values: { title: picked.title } });
  }

  if (info.subject) entry.description = info.subject;

  // A document that declares its own language beats the interface language: an
  // English deck converted in a Czech interface should still give its learners
  // English buttons. A language the author pinned by hand beats both.
  if (!courseLanguagePinned) {
    const declared = courseLanguage(
      info.language, LANGUAGES.map((l) => l.code), info.sampleText,
    );
    if (declared) {
      entry.languageFromPdf = true;
      if (declared !== entry.language) {
        entry.language = declared;
        entry.notices.push({ key: 'notice.language', values: { lang: declared } });
      }
    }
  }

  // A scan has no text to attach. Said here; acted on at build time, where the
  // option is simply not applied to a document that has nothing to give.
  if (!info.hasText) entry.notices.push({ key: 'notice.scanned' });
}

/** One notice, rendered in the current interface language. */
function noticeText(notice) {
  if (notice.key === 'notice.language') {
    // Named the way the interface language would say it in a sentence, which
    // is not what the picker shows: Czech needs a case ending here.
    return t('notice.language', { language: t(`lang.${notice.values.lang}`) || notice.values.lang });
  }
  return t(notice.key, notice.values);
}

function fileLine(entry) {
  const size = formatBytes(entry.file.size);
  if (entry.status === 'reading') return `${entry.file.name} — ${size}, ${t('source.reading')}`;
  if (entry.status === 'failed') return `${entry.file.name} — ${size}`;
  const count = entry.info.numPages;
  return `${entry.file.name} — ${size}, ${count} ${t(count === 1 ? 'source.page' : 'source.pages')}`;
}

/**
 * Redraws everything about the files in hand.
 *
 * One file: the line under the drop zone and the notices, as ever, with the
 * Settings fields mirroring the course. Several: a list with a row per course,
 * each carrying its own title and language, and the per-course Settings fields
 * stood down with a note saying where those now live.
 */
function refreshIntake() {
  const bulk = courses.length > 1;

  ui.filemeta.hidden = bulk || !courses.length;
  ui.notices.hidden = true;
  ui.queue.hidden = !bulk;
  ui.courseFields.hidden = bulk;
  ui.bulkNote.hidden = !bulk;

  if (single()) {
    const entry = courses[0];
    ui.filemeta.textContent = fileLine(entry);
    if (entry.status === 'failed') {
      fail(entry.error);
    } else if (entry.status === 'ready') {
      mirrorToFields(entry);
      const notes = entry.notices.map(noticeText);
      if (!entry.info.hasText) ui.extractText.checked = false;
      if (notes.length) {
        notes.push(t('notice.settings'));
        ui.notices.replaceChildren(...notes.map((text) => {
          const li = document.createElement('li');
          li.textContent = text;
          return li;
        }));
        ui.notices.hidden = false;
      }
    }
  }

  if (bulk) renderQueue();

  const anyReady = ready().length > 0;
  ui.build.disabled = busy || !anyReady;
  ui.build.textContent = bulk && anyReady
    ? t('build.actionMany', { count: counted(ready().length, 'unit.course') })
    : t('build.action');
}

/** The Settings fields show the one course; edits go straight back to it. */
function mirrorToFields(entry) {
  ui.title.value = entry.title;
  ui.description.value = entry.description;
  ui.language.value = entry.language;
}
ui.title.addEventListener('input', () => { if (single()) courses[0].title = ui.title.value; });
ui.description.addEventListener('input', () => {
  if (single()) courses[0].description = ui.description.value;
});

/** The list for several files: one row per course, editable in place. */
function renderQueue() {
  const frag = document.createDocumentFragment();

  for (const entry of courses) {
    const row = document.createElement('li');
    row.className = 'queue__row';
    row.dataset.status = entry.status;

    const file = document.createElement('div');
    file.className = 'queue__file';
    file.textContent = fileLine(entry);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'queue__remove';
    remove.title = t('queue.remove');
    remove.setAttribute('aria-label', `${t('queue.remove')}: ${entry.file.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      courses = courses.filter((c) => c !== entry);
      refreshIntake();
    });

    const head = document.createElement('div');
    head.className = 'queue__head';
    head.append(file, remove);
    row.appendChild(head);

    if (entry.status === 'failed') {
      const error = document.createElement('p');
      error.className = 'queue__error';
      error.textContent = entry.error;
      row.appendChild(error);
    }

    if (entry.status === 'ready') {
      const fields = document.createElement('div');
      fields.className = 'queue__fields';

      const title = document.createElement('input');
      title.type = 'text';
      title.className = 'queue__title';
      title.value = entry.title;
      title.setAttribute('aria-label', t('course.title'));
      title.addEventListener('input', () => { entry.title = title.value; });

      const language = document.createElement('select');
      language.className = 'queue__lang';
      languageOptions(language);
      language.value = entry.language;
      language.setAttribute('aria-label', t('course.language'));
      language.addEventListener('change', () => {
        entry.language = language.value;
        // Picked by hand for this course: nothing moves it again.
        entry.languageFromPdf = true;
      });

      fields.append(title, language);
      row.appendChild(fields);

      if (entry.notices.length) {
        const notes = document.createElement('ul');
        notes.className = 'queue__notices';
        for (const notice of entry.notices) {
          const li = document.createElement('li');
          li.textContent = noticeText(notice);
          notes.appendChild(li);
        }
        row.appendChild(notes);
      }
    }

    frag.appendChild(row);
  }

  ui.queue.replaceChildren(frag);
}

/* ---------- option plumbing ---------- */

ui.quality.addEventListener('input', () => { ui.qualityOut.value = ui.quality.value; });

ui.completionRule.addEventListener('change', () => {
  ui.thresholdField.hidden = ui.completionRule.value !== 'percent';
});

// Options that only mean something for one standard hide with it.
ui.standards.addEventListener('change', syncStandardOptions);

function syncStandardOptions() {
  const picked = selectedStandards();
  ui.moveOnField.hidden = !picked.includes('cmi5');
  ui.perPageRow.hidden = !picked.includes('xapi');
  ui.schemasRow.hidden = !picked.some((id) => id === 'scorm12' || id === 'scorm2004');
}

function selectedStandards() {
  return Array.from(ui.standards.querySelectorAll('input[type="checkbox"]:checked'))
    .map((box) => box.value);
}

/** The options every course in the batch shares. */
function sharedSettings() {
  const masteryPercent = ui.mastery.value.trim();
  const parsedMastery = masteryPercent === '' ? null : Number(masteryPercent);

  return {
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

/**
 * The options for one course: what was worked out from its PDF, what the
 * author changed, and an identifier no other course in the batch is using.
 */
function courseSettings(entry, identifier, shared) {
  return {
    ...shared,
    title: entry.title.trim() || t('course.fallbackTitle'),
    description: entry.description.trim(),
    identifier,
    language: entry.language,
    // The IRI field is a single-course affair; in a batch each course gets the
    // derived one, which is what the field's placeholder promises anyway.
    activityIri: single() ? ui.activityIri.value.trim() : '',
    // A scan has nothing to extract, whatever the checkbox says.
    extractText: shared.extractText && Boolean(entry.info && entry.info.hasText),
  };
}

/**
 * Identifiers for the batch, made unique.
 *
 * Two PDFs called "Onboarding" would otherwise produce two packages with the
 * same file name, and the second would overwrite the first inside a bundle.
 */
function uniqueIdentifiers(entries) {
  const seen = new Map();
  return entries.map((entry) => {
    const wanted = single() && ui.identifier.value.trim()
      ? safeId(ui.identifier.value.trim(), 'course')
      : safeId(entry.title, 'course');
    const count = (seen.get(wanted) || 0) + 1;
    seen.set(wanted, count);
    return count === 1 ? wanted : `${wanted}-${count}`;
  });
}

/* ---------- build ---------- */

ui.build.addEventListener('click', run);

async function run() {
  const batch = ready();
  if (busy || !batch.length) return;

  const standards = selectedStandards();
  if (!standards.length) {
    fail(t('build.noStandards'));
    return;
  }

  busy = true;
  ui.build.disabled = true;
  clearError();
  releaseUrls();
  for (const course of courses) course.built = [];
  ui.results.hidden = true;
  ui.resultsList.replaceChildren();
  ui.progress.hidden = false;

  const shared = sharedSettings();
  const identifiers = uniqueIdentifiers(batch);

  try {
    // Rendering dominates the wall clock, so it gets most of each course's
    // share of the bar.
    const RENDER_SHARE = 0.75;
    const span = 1 / batch.length;

    for (let c = 0; c < batch.length; c++) {
      const entry = batch[c];
      const base = c * span;
      const options = courseSettings(entry, identifiers[c], shared);
      const prefix = batch.length > 1
        ? `${t('build.course', { title: options.title, index: c + 1, total: batch.length })} — `
        : '';

      setProgress(base, prefix + t('build.reading'));
      const bytes = await entry.file.arrayBuffer();

      const render = await renderPdf(bytes, options, (done, total) => {
        setProgress(
          base + span * RENDER_SHARE * (done / total),
          prefix + t('build.rendering', { done, total }),
        );
      });

      // Decoration; a batch of them would be a wall of bitmaps.
      if (batch.length === 1) showPreview(render);

      for (let i = 0; i < standards.length; i++) {
        const id = standards[i];
        setProgress(
          base + span * (RENDER_SHARE + (i / standards.length) * (1 - RENDER_SHARE)),
          prefix + t('build.packaging', { standard: id }),
        );
        entry.built.push(await buildPackage(render, options, id));
      }
    }

    const total = batch.reduce((n, entry) => n + entry.built.length, 0);
    setProgress(1, t('build.done', { count: total }));
    showResults(batch, standards);
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

/**
 * The packages, one row each, and a way to take them all.
 *
 * One course: a single "everything in one zip" button, as before. Several: one
 * button per format, each bundling that format's package for every course --
 * because an LMS imports one zip per course and format, and a batch upload
 * wants all the SCORM 1.2 ones together, not a mix.
 */
function showResults(batch, standards) {
  const bulk = batch.length > 1;
  const frag = document.createDocumentFragment();

  // Two courses in a batch may well share a title -- two decks called
  // "Onboarding" -- and their rows must still be told apart, so a repeated
  // title carries its file name too.
  const titleOf = (entry) => entry.title.trim() || t('course.fallbackTitle');
  const repeated = new Set(
    batch.map(titleOf).filter((title, i, all) => all.indexOf(title) !== i),
  );

  for (const entry of batch) {
    for (const pkg of entry.built) {
      const item = document.createElement('li');

      if (bulk) {
        const course = document.createElement('span');
        course.className = 'results__course';
        const title = titleOf(entry);
        course.textContent = repeated.has(title) ? `${title} (${entry.file.name})` : title;
        course.title = entry.file.name;
        item.appendChild(course);
      }

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
    }
  }

  ui.resultsList.replaceChildren(frag);
  ui.results.hidden = false;

  const all = batch.flatMap((entry) => entry.built);

  // Browsers block a burst of automatic downloads, so several packages get one
  // combined zip rather than one click each.
  ui.downloadAll.hidden = bulk || all.length < 2;
  ui.downloadFormats.hidden = !bulk;
  ui.downloadFormats.replaceChildren();

  if (!bulk) {
    const entry = batch[0];
    ui.downloadAll.onclick = () => bundleAndSave(
      ui.downloadAll, all, entry.built[0].identifier || entry.title, null,
    );
    return;
  }

  for (const standardId of standards) {
    const ofKind = all.filter((pkg) => pkg.standard === standardId);
    if (!ofKind.length) continue;
    const label = (BY_ID[standardId] && BY_ID[standardId].label) || standardId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.textContent = t('build.downloadFormat', {
      standard: label, count: counted(ofKind.length, 'unit.course'),
    });
    button.addEventListener('click', () => bundleAndSave(
      button, ofKind, `${standardId}-${ofKind.length}-courses`,
      `${standardId}-${ofKind.length}-courses.zip`,
    ));
    ui.downloadFormats.appendChild(button);
  }
}

async function bundleAndSave(button, packages, name, filename) {
  button.disabled = true;
  try {
    const zip = await bundle(packages, name, filename);
    save(zip.blob, zip.filename);
  } catch (err) {
    fail(t('build.bundleFailed', { message: err.message }));
  } finally {
    button.disabled = false;
  }
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
