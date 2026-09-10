// Assembles a finished e-learning package as a zip, in memory.
//
// Layout inside every package:
//
//   <manifest>            imsmanifest.xml, tincan.xml or cmi5.xml
//   index.html            the player
//   player.css
//   player.js
//   lms-adapter.js        the standard's adapter, renamed on the way in
//   content/pages.json    page list, geometry, transcribed text, settings
//   content/p001.webp     one image per page
//   SCORM-schemas/*.xsd   only when "Include SCORM schema files" is on
//
// The player is fetched from this site rather than inlined as a string, so it
// stays ordinary editable source. That is also why the converter has to be
// served over http:// -- see server.js.

import { BY_ID } from './standards/index.js';
import { extensionFor } from './pdf-render.js';
import { id as safeId, iri } from './standards/xml.js';
import { playerStrings } from './i18n.js';

// index.html is not here: it needs the course manifest written into it, so it
// is assembled once that exists.
const PLAYER_FILES = [
  { from: 'player/player.css', to: 'player.css' },
  { from: 'player/player.js', to: 'player.js' },
];

const GENERATOR = 'pdf-to-scorm-converter 1.0.0';

// Where schemas land inside the package. Keeping them in a subfolder rather
// than the root is the convention pipwerks documents, and keeps the root
// readable.
const SCHEMA_FOLDER = 'SCORM-schemas';

// Images arrive already compressed; running DEFLATE over them costs time and
// saves nothing, so only the text entries are deflated.
const STORE = { compression: 'STORE' };
const DEFLATE = { compression: 'DEFLATE', compressionOptions: { level: 6 } };

const playerCache = new Map();

/**
 * Writes the course manifest into the player's inline JSON block.
 *
 * Without this the package only works when something serves it over HTTP: a
 * page opened from file:// cannot fetch its own siblings, so the player's
 * fallback fetch of content/pages.json fails and nothing loads.
 *
 * The manifest carries text transcribed out of the PDF, which can contain
 * anything at all -- including the characters that would end the script block
 * early. Escaping "<" and ">" is invisible to JSON.parse and keeps the
 * surrounding block intact whatever the document happened to say.
 */
function withCourseData(html, manifest) {
  const json = JSON.stringify(manifest)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  const slot = '<script type="application/json" id="course-data">{}</script>';
  if (!html.includes(slot)) {
    throw new Error('player/index.html has no course-data block to fill in');
  }
  return html.replace(
    slot,
    '<script type="application/json" id="course-data">' + json + '</script>',
  );
}

async function asset(path) {
  // The single-file build embeds these, because a file:// page cannot fetch a
  // sibling file. Served normally, they are fetched as usual.
  const embedded = (typeof window !== 'undefined' && window.__EMBEDDED_ASSETS) || null;
  if (embedded && path in embedded) return embedded[path];

  if (!playerCache.has(path)) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not read ${path} (HTTP ${response.status})`);
    playerCache.set(path, await response.text());
  }
  return playerCache.get(path);
}

function pageName(n, total, ext, prefix = 'p') {
  const width = String(total).length;
  return `${prefix}${String(n).padStart(width, '0')}.${ext}`;
}

/**
 * @param {object}   render    result of renderPdf()
 * @param {object}   settings  course metadata and options from the UI
 * @param {string}   standardId  one of scorm12 | scorm2004 | xapi | cmi5
 * @returns {Promise<{blob: Blob, filename: string, label: string}>}
 */
export async function buildPackage(render, settings, standardId) {
  const standard = BY_ID[standardId];
  if (!standard) throw new Error(`Unknown standard: ${standardId}`);

  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('JSZip failed to load');

  const zip = new JSZip();
  const ext = extensionFor(settings.format);
  const total = render.pages.length;

  const identifier = safeId(settings.identifier || settings.title, 'course');
  const course = {
    identifier,
    title: settings.title || 'Course',
    description: settings.description || '',
    language: settings.language || 'en',
    activityIri: iri(settings.activityIri, identifier),
    masteryScore: settings.masteryScore,
    moveOn: settings.moveOn,
    includeSchemas: Boolean(settings.includeSchemas) && Boolean(standard.schemaFiles),
  };

  // --- player ---
  for (const file of PLAYER_FILES) {
    zip.file(file.to, await asset(file.from), DEFLATE);
  }
  zip.file('lms-adapter.js', await asset(`player/adapters/${standard.adapter}.js`), DEFLATE);
  const playerHtml = await asset('player/index.html');

  // --- page images and content manifest ---
  const pages = [];
  for (const page of render.pages) {
    const name = pageName(page.pageNumber, total, ext);
    zip.file(`content/${name}`, page.blob, STORE);

    // A small copy for the page list. Without it the list pulls every
    // full-resolution page at once -- 4.5 MB on a real 38-page deck -- to draw
    // them a hundred pixels wide.
    const entry = {
      n: page.pageNumber,
      src: name,
      w: Math.round(page.width),
      h: Math.round(page.height),
      text: settings.extractText ? page.text : '',
    };
    if (page.thumb) {
      const thumbName = pageName(page.pageNumber, total, extensionFor(page.thumb.type), 'thumb');
      zip.file(`content/${thumbName}`, page.thumb, STORE);
      entry.thumb = thumbName;
    }
    pages.push(entry);
  }

  const content = {
    generator: GENERATOR,
    created: new Date().toISOString(),
    standard: standard.id,
    title: course.title,
    language: course.language,
    pages,
    // Resolved here rather than looked up in the player, so a package carries
    // only the language its learners read.
    ui: playerStrings(course.language),
    completion: {
      rule: settings.completionRule,
      threshold: settings.completionThreshold,
    },
    masteryScore: course.masteryScore,
  };
  if (standard.id === 'xapi') {
    content.xapi = { perPageStatements: settings.perPageStatements !== false };
  }
  if (standard.id === 'cmi5') {
    content.cmi5 = { moveOn: course.moveOn };
  }
  zip.file('content/pages.json', JSON.stringify(content, null, 2), DEFLATE);
  zip.file('index.html', withCourseData(playerHtml, content), DEFLATE);

  // --- optional schema files ---
  if (course.includeSchemas) {
    for (const name of standard.schemaFiles) {
      zip.file(
        `${SCHEMA_FOLDER}/${name}`,
        await asset(`schemas/${standard.schemaDir}/${name}`),
        DEFLATE,
      );
    }
  }

  // --- manifest ---
  // SCORM requires every file making up the resource to be declared. The
  // schemas are package-level metadata rather than part of the resource, so
  // they are excluded -- which is also what the ADL reference packages do.
  const paths = Object.keys(zip.files)
    .filter((path) => !zip.files[path].dir)
    .filter((path) => !path.startsWith(`${SCHEMA_FOLDER}/`))
    .sort();

  for (const file of standard.files(course, paths)) {
    zip.file(file.path, file.text, DEFLATE);
  }

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });

  return {
    blob,
    filename: `${identifier}-${standard.id}.zip`,
    label: standard.label,
    // So a batch can be grouped by kind without parsing file names.
    standard: standard.id,
    identifier,
    bytes: blob.size,
  };
}

/** Wraps several built packages into a single zip, for convenience. */
/**
 * Several packages in one zip, so a browser's one-download-per-click rule does
 * not turn four packages into four clicks.
 *
 * @param {string} [filename] the zip's own name; defaults to the single-course
 *   "<course>-all-packages.zip", which is wrong for a batch grouped by format
 */
export async function bundle(packages, name, filename) {
  const zip = new window.JSZip();
  for (const pkg of packages) zip.file(pkg.filename, pkg.blob, STORE);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return {
    blob,
    filename: filename || `${safeId(name, 'course')}-all-packages.zip`,
    bytes: blob.size,
  };
}
