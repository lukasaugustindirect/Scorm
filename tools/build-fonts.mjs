#!/usr/bin/env node
// Regenerates app/fonts.css from the woff2 files in vendor/fonts/.
//
//   node tools/build-fonts.mjs
//
// The typeface has to be embedded as base64 rather than linked, because the
// single-file build runs from file://, where a page cannot fetch its own
// siblings. Running this by hand is rare -- only when the vendored Inter is
// updated -- but a generated file with no generator is a file nobody can
// safely change.
//
// The unicode-range values are lifted out of the upstream stylesheet rather
// than typed in here: a hand-copied range is how a missing glyph gets shipped.
// vendor/fonts/wght.css is that stylesheet, kept alongside the fonts for
// exactly this purpose.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = join(ROOT, 'vendor', 'fonts');
const OUT = join(ROOT, 'app', 'fonts.css');

// latin-ext carries only the accented characters, so Czech needs both subsets.
const SUBSETS = ['latin', 'latin-ext'];

const HEADER = `/* The typeface, embedded.
 *
 * Inter Variable, latin + latin-ext, from @fontsource-variable/inter
 * (SIL Open Font License -- see vendor/fonts/inter-LICENSE.txt). Two subsets
 * rather than one because latin-ext carries only the accented characters:
 * Czech needs both, and unicode-range lets the browser take just what a page
 * actually uses.
 *
 * Base64 rather than a url() to a sibling file, because the single-file build
 * has to work from file://, where a page cannot fetch its own siblings. That is
 * also why this lives in its own stylesheet: index.html links it separately so
 * app.css stays small and readable, and tools/build-single.mjs inlines both.
 *
 * GENERATED -- do not hand-edit. Run: node tools/build-fonts.mjs
 */

`;

/** The published unicode-range for one subset, read rather than retyped. */
function unicodeRange(upstream, subset) {
  const found = new RegExp(
    `/\\* inter-${subset}-wght-normal \\*/[\\s\\S]*?unicode-range: ([^;]+);`,
  ).exec(upstream);
  if (!found) {
    throw new Error(
      `no unicode-range for the ${subset} subset in vendor/fonts/wght.css`,
    );
  }
  return found[1].trim();
}

async function main() {
  const upstream = await readFile(join(FONTS, 'wght.css'), 'utf8');

  const blocks = [];
  for (const subset of SUBSETS) {
    const file = join(FONTS, `inter-${subset}-wght-normal.woff2`);
    const data = await readFile(file);
    blocks.push(
      `/* Inter Variable, ${subset} subset (${Math.round(data.length / 1024)} kB) */\n` +
      `@font-face {\n` +
      `  font-family: 'Inter Variable';\n` +
      `  font-style: normal;\n` +
      `  font-display: swap;\n` +
      `  font-weight: 100 900;\n` +
      `  src: url(data:font/woff2;base64,${data.toString('base64')}) format('woff2-variations');\n` +
      `  unicode-range: ${unicodeRange(upstream, subset)};\n` +
      `}`,
    );
  }

  await writeFile(OUT, HEADER + blocks.join('\n\n') + '\n', 'utf8');
  const { size } = await stat(OUT);
  console.log(`app/fonts.css  ${Math.round(size / 1024)} kB  (${SUBSETS.length} subsets embedded)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
