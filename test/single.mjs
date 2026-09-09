// Builds the single-file variant and drives it from file://.
//
// Without this the single-file build rots silently: it reaches into the app's
// internals (an esbuild bundle, a shimmed pdf.js, embedded assets) and any
// change to how pdf-render.js or package-builder.js load things would break it
// while the served app kept passing.
//
// The point of that build is that it works with no server, so the test has to
// open it as a real file:// document -- the one context where module scripts,
// module workers and fetch of a sibling file all fail.

import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function build(repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(repoRoot, 'tools/build-single.mjs')], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`build:single failed (exit ${code}):\n${out}`));
    });
  });
}

export async function testSingleFile(browser, outDir, repoRoot, pdfPath, pageCount) {
  const problems = [];
  const expect = (ok, label, detail) => {
    if (ok) {
      console.log(`    ok   ${label}`);
    } else {
      console.log(`    FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
      problems.push(`single-file: ${label}`);
    }
  };

  console.log('\n  single-file build');

  const built = join(outDir, 'single');
  await rm(built, { recursive: true, force: true });
  await mkdir(built, { recursive: true });

  const summary = await build(repoRoot);
  console.log(`    (${summary})`);

  const htmlPath = join(repoRoot, 'dist', 'pdf-to-scorm.html');
  const info = await stat(htmlPath);
  expect(info.size > 500 * 1024, 'the built file carries its libraries',
         `${Math.round(info.size / 1024)} kB`);

  // A fresh context, so nothing from the served-app stages can leak in and make
  // this pass for the wrong reason.
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', (err) => failures.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const from = msg.location()?.url || '';
    if (/\/favicon\.ico$/.test(from)) return;
    failures.push(`console error: ${msg.text().slice(0, 160)}`);
  });

  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

    const protocol = await page.evaluate(() => window.location.protocol);
    expect(protocol === 'file:', 'runs as a file:// document', protocol);

    await page.setInputFiles('#file', pdfPath);
    await page.waitForFunction(
      () => !document.getElementById('build').disabled,
      null,
      { timeout: 60000 },
    );

    const meta = await page.textContent('#filemeta');
    expect(meta.includes(`${pageCount} pages`),
           'pdf.js parsed the file with a Blob worker', meta.trim());

    // Same options the served-app stage uses, so verify.py's expectations hold
    // for these packages too.
    await page.fill('#identifier', 'fixture-course');
    await page.fill('#activity-iri', 'https://example.com/courses/fixture');
    await page.fill('#mastery', '80');
    await page.selectOption('#format', 'image/png');

    await page.click('#build');
    await page.waitForSelector('#results:not([hidden])', { timeout: 180000 });

    const rows = await page.locator('#results-list li').count();
    expect(rows === 4, 'builds all four standards', String(rows));

    for (let i = 0; i < rows; i++) {
      const row = page.locator('#results-list li').nth(i);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        row.locator('button.dl').click(),
      ]);
      await download.saveAs(join(built, download.suggestedFilename()));
    }
    // The whole variant hinges on this: a file:// page may still hand over a
    // download, which is the only way it can deliver a package.
    expect(rows > 0, 'downloads work from a file:// page');

    await page.selectOption('#ui-language', 'cs');
    const czech = await page.textContent('#build');
    expect(czech.includes('Vytvořit'), 'carries both languages', czech.trim());

    const uiError = await page.locator('#error:not([hidden])').count();
    if (uiError) failures.push(`UI error: ${await page.textContent('#error')}`);
  } finally {
    await context.close();
  }

  problems.push(...failures.map((f) => `single-file: ${f}`));
  failures.forEach((f) => console.log(`    FAIL ${f}`));
  if (!failures.length) console.log('    ok   no page or console errors');

  return problems;
}
