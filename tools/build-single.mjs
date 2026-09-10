#!/usr/bin/env node
// Builds the whole converter into ONE self-contained .html file.
//
//   npm run build:single     ->  dist/pdf-to-scorm.html
//
// The point is portability: that file opens by double-click, needs no server,
// no Node, no internet, and can be emailed as a single attachment.
//
// Getting there means working around three things a file:// page cannot do,
// which is why this build exists at all rather than just concatenating files:
//
//   1. It cannot load ES modules (CORS on module scripts), so the app is
//      bundled into one classic script with esbuild.
//   2. It cannot start a *module* Worker, though a *classic* one from a Blob
//      URL is allowed. pdf.js 3.11.174 is the last release shipping a
//      non-module worker, so the single-file build uses that classic pair from
//      vendor/classic/ while the served app keeps the modern ESM build.
//   3. It cannot fetch a sibling file, so the player, its adapters and the
//      schema files are embedded as strings.
//
// Downloads do work from file://, which is what makes the whole thing viable.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'dist');
const OUT_FILE = join(OUT_DIR, 'pdf-to-scorm.html');

// Everything package-builder.js would otherwise fetch, keyed by the exact path
// it asks for.
const EMBED = [
  'player/index.html',
  'player/player.css',
  'player/player.js',
  'player/adapters/scorm12.js',
  'player/adapters/scorm2004.js',
  'player/adapters/xapi.js',
  'player/adapters/cmi5.js',
  'schemas/scorm12/imscp_rootv1p1p2.xsd',
  'schemas/scorm12/adlcp_rootv1p2.xsd',
  'schemas/scorm12/imsmd_rootv1p2p1.xsd',
  'schemas/scorm12/ims_xml.xsd',
  'schemas/scorm2004/imscp_v1p1.xsd',
  'schemas/scorm2004/adlcp_v1p3.xsd',
  'schemas/scorm2004/adlseq_v1p3.xsd',
  'schemas/scorm2004/adlnav_v1p3.xsd',
  'schemas/scorm2004/imsss_v1p0.xsd',
  'schemas/scorm2004/imsss_v1p0auxresource.xsd',
  'schemas/scorm2004/imsss_v1p0control.xsd',
  'schemas/scorm2004/imsss_v1p0delivery.xsd',
  'schemas/scorm2004/imsss_v1p0limit.xsd',
  'schemas/scorm2004/imsss_v1p0objective.xsd',
  'schemas/scorm2004/imsss_v1p0random.xsd',
  'schemas/scorm2004/imsss_v1p0rollup.xsd',
  'schemas/scorm2004/imsss_v1p0seqrule.xsd',
  'schemas/scorm2004/imsss_v1p0util.xsd',
  'schemas/scorm2004/xml.xsd',
];

// Maps the modern pdf.js import onto the classic global that the inlined
// UMD build installs, so app/pdf-render.js needs no branching of its own.
const PDFJS_SHIM = `
const lib = window.pdfjsLib;
export const getDocument = (...args) => lib.getDocument(...args);
export const GlobalWorkerOptions = lib.GlobalWorkerOptions;
export const version = lib.version;
`;

const read = (rel) => readFile(join(ROOT, rel), 'utf8');

/**
 * A </script> anywhere in verbatim-inlined text would end the block early.
 * Only the library bundles go in raw, and none of them contain one; if that
 * ever changes the build must fail loudly rather than emit a broken file.
 */
function assertInlineSafe(name, text) {
  if (/<\/script/i.test(text)) {
    throw new Error(`${name} contains "</script" and cannot be inlined verbatim`);
  }
}

/**
 * The embedded assets DO contain </script> -- the player's own markup loads
 * its adapter that way -- so they travel as JSON with "<" escaped. The escape
 * is invisible to JSON.parse and keeps the surrounding block intact.
 */
function jsonForScriptBlock(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

async function bundleApp() {
  const result = await esbuild.build({
    entryPoints: [join(ROOT, 'app/main.js')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    // import.meta.url is unavailable in a classic script. Every use of it is
    // behind an override the single-file build supplies, so it is never
    // evaluated -- but it still has to parse.
    define: { 'import.meta.url': '""' },
    plugins: [{
      name: 'pdfjs-global',
      setup(build) {
        build.onResolve({ filter: /vendor\/pdf\.min\.mjs$/ }, () => ({
          path: 'pdfjs-global', namespace: 'shim',
        }));
        build.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
          contents: PDFJS_SHIM, loader: 'js',
        }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

async function main() {
  const [fontCss, css, pdfLib, pdfWorker, jszip, indexHtml, appBundle] = await Promise.all([
    read('app/fonts.css'),
    read('app/app.css'),
    read('vendor/classic/pdf.min.js'),
    read('vendor/classic/pdf.worker.min.js'),
    read('vendor/jszip.min.js'),
    read('index.html'),
    bundleApp(),
  ]);

  const embedded = {};
  for (const path of EMBED) embedded[path] = await read(path);

  for (const [name, text] of [
    ['pdf.min.js', pdfLib], ['pdf.worker.min.js', pdfWorker], ['jszip.min.js', jszip],
    ['app bundle', appBundle],
  ]) assertInlineSafe(name, text);

  for (const [name, text] of [['app/fonts.css', fontCss], ['app/app.css', css]]) {
    if (/<\/style/i.test(text)) {
      throw new Error(`${name} contains "</style" and cannot be inlined verbatim`);
    }
  }

  // Reuse the served page's markup so there is one source of truth for the UI.
  // Its <head> and the script/style tags that assume separate files go.
  // The page's identity -- language, title, icon -- is lifted from index.html
  // too. Keeping a second copy here is how the two drift apart.
  const lang = /<html lang="([^"]+)"/.exec(indexHtml)?.[1] || 'en';
  const title = /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1] || 'PDF to SCORM';
  const icon = /<link rel="icon"[^>]*>/.exec(indexHtml)?.[0] || '';

  const bodyStart = indexHtml.indexOf('<body>') + '<body>'.length;
  const bodyEnd = indexHtml.lastIndexOf('</body>');
  if (bodyStart < 6 || bodyEnd < 0) throw new Error('could not find <body> in index.html');

  const body = indexHtml
    .slice(bodyStart, bodyEnd)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .trim();

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${icon}
<title>${title}</title>
<style>
${fontCss}
</style>
<style>
${css}
</style>
</head>
<body>
${body}

<!-- The pdf.js worker, kept as inert text so it can be turned into a Blob at
     run time. A file:// page cannot load a worker from a sibling file, but it
     can start a classic worker from a Blob URL. -->
<script type="text/plain" id="pdfjs-worker">${pdfWorker}</script>

<script>${pdfLib}</script>
<script>${jszip}</script>

<script>
// Hand the app everything it would otherwise have fetched.
window.__PDF_OVERRIDES = {
  workerSrc: URL.createObjectURL(new Blob(
    [document.getElementById('pdfjs-worker').textContent],
    { type: 'text/javascript' },
  )),
  // No directory to serve font data from. pdf.js substitutes a system font for
  // the standard 14 and warns; embedded fonts, which most real PDFs use, are
  // unaffected.
  standardFontDataUrl: '',
};
window.__EMBEDDED_ASSETS = ${jsonForScriptBlock(embedded)};
</script>

<script>${appBundle}</script>
</body>
</html>
`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, html, 'utf8');

  const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
  console.log(`dist/pdf-to-scorm.html  ${mb} MB  (single file, opens by double-click)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
