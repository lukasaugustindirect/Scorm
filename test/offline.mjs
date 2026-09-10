// Unzips a built package and opens it the way a person checking their work
// does: by double-clicking index.html.
//
// This exists because that was broken and nothing noticed. The player fetched
// content/pages.json, and a file:// page cannot fetch its own siblings, so an
// unzipped package showed "This course could not be loaded: Failed to fetch"
// and nothing else. Every other stage serves the package over HTTP, where the
// fetch succeeds, so the whole suite stayed green while the first thing anyone
// would try was dead.
//
// The manifest now rides inline in index.html and the fetch is only a fallback.
// Page images are <img src> and were never affected -- it is worth knowing that
// the two load differently on file://, which is the trap.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readZip } from '../tools/unpack.mjs';

export async function testOffline(browser, outDir, pageCount) {
  const problems = [];
  console.log('\n  unzipped and opened from file://');

  const work = join(outDir, 'offline');
  await rm(work, { recursive: true, force: true });

  const zips = ['scorm12', 'scorm2004', 'xapi', 'cmi5']
    .map((s) => join(outDir, `fixture-course-${s}.zip`));

  for (const zipPath of zips) {
    const name = basename(zipPath, '.zip');
    const root = join(work, name);
    for (const entry of readZip(await readFile(zipPath))) {
      const dest = join(root, entry.name);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, entry.data);
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    const faults = [];
    page.on('pageerror', (err) => faults.push(`page error: ${err.message}`));

    try {
      await page.goto(pathToFileURL(join(root, 'index.html')).href, { waitUntil: 'load' });
      // The player boots asynchronously and then decodes the first image.
      await page.waitForFunction(
        () => {
          const img = document.getElementById('page-img');
          return !!img && img.naturalWidth > 0;
        },
        null,
        { timeout: 15000 },
      ).catch(() => { /* reported below with better detail */ });

      const state = await page.evaluate(() => {
        const loading = document.getElementById('loading');
        const img = document.getElementById('page-img');
        return {
          thumbs: document.querySelectorAll('.thumb').length,
          total: document.getElementById('page-total')?.textContent,
          rendered: !!img && img.naturalWidth > 0,
          // The player puts its failure here, which is what the user saw.
          message: loading && !loading.hidden ? (loading.textContent || '').trim() : '',
          // Proof the data came from the inline block rather than a fetch: on
          // file:// there is no other way it could have arrived.
          inlineBytes: (document.getElementById('course-data')?.textContent || '').length,
        };
      });

      const expect = (ok, label, detail) => {
        if (ok) {
          console.log(`    ok   ${name}: ${label}`);
        } else {
          console.log(`    FAIL ${name}: ${label}${detail ? ` -- ${detail}` : ''}`);
          problems.push(`offline: ${name}: ${label}`);
        }
      };

      expect(!state.message, 'loads without an error message', state.message);
      expect(state.inlineBytes > 100, 'carries the manifest inline',
             `${state.inlineBytes} bytes`);
      expect(state.thumbs === pageCount, `lists all ${pageCount} pages`,
             String(state.thumbs));
      expect(state.total === String(pageCount), 'reports the page count',
             String(state.total));
      expect(state.rendered, 'renders the first page image');
    } finally {
      await context.close();
    }

    problems.push(...faults.map((f) => `offline: ${name}: ${f}`));
    faults.forEach((f) => console.log(`    FAIL ${name}: ${f}`));
  }

  return problems;
}
