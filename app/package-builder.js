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

const PLAYER_FILES = [
  { from: 'player/index.html', to: 'index.html' },
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

async function asset(path) {
  if (!playerCache.has(path)) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not read ${path} (HTTP ${response.status})`);
    playerCache.set(path, await response.text());
  }
  return playerCache.get(path);
}

function pageName(n, total, ext) {
  const width = String(total).length;
  return `p${String(n).padStart(width, '0')}.${ext}`;
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

  // --- page images and content manifest ---
  const pages = [];
  for (const page of render.pages) {
    const name = pageName(page.pageNumber, total, ext);
    zip.file(`content/${name}`, page.blob, STORE);
    pages.push({
      n: page.pageNumber,
      src: name,
      w: Math.round(page.width),
      h: Math.round(page.height),
      text: settings.extractText ? page.text : '',
    });
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
    bytes: blob.size,
  };
}

/** Wraps several built packages into a single zip, for convenience. */
export async function bundle(packages, name) {
  const zip = new window.JSZip();
  for (const pkg of packages) zip.file(pkg.filename, pkg.blob, STORE);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return { blob, filename: `${safeId(name, 'course')}-all-packages.zip`, bytes: blob.size };
}
