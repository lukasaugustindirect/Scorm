#!/usr/bin/env node
// End-to-end test.
//
// Drives the real converter in a real browser against a generated PDF, saves
// every package it produces, then hands the zips to verify.py for inspection.
// Nothing here stubs pdf.js or JSZip: the point is to catch the things that
// only break in a browser, such as a worker that will not start or a manifest
// that comes out malformed.

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makePdf } from './fixture.mjs';
import { testPlayer } from './player.mjs';
import { testStatements } from './statements.mjs';
import { testSingleFile } from './single.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'output');

const FIXTURE_PAGES = 3;
const FIXTURE_TITLE = 'Fixture Document';
const STANDARDS = ['scorm12', 'scorm2004', 'xapi', 'cmi5'];

/**
 * Every Playwright this machine offers, most local first.
 *
 * There can be more than one, and they need not agree: a local install pulled
 * in by `npm install` expects the browser build of its own release, while a
 * pre-provisioned environment may carry a different one globally. Rather than
 * pick and hope, collect them all and let launch() find a working pair.
 */
async function loadPlaywrights() {
  const found = [];
  const add = (mod) => {
    // Playwright is CommonJS, so importing it by path yields a namespace whose
    // only member is `default`; an ESM-aware resolution exposes it directly.
    const api = mod && (mod.chromium ? mod : mod.default);
    if (api && api.chromium) found.push(api);
  };

  try {
    add(await import('playwright'));
  } catch { /* no local install */ }

  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    add(await import(pathToFileURL(join(root, 'playwright', 'index.js')).href));
  } catch { /* no global install */ }

  if (!found.length) throw new Error('Playwright is not installed');
  return found;
}

/**
 * Chromium binaries actually present, whatever build number they carry.
 * Playwright stores them as chromium-<build>/, and that number tracks the
 * Playwright release rather than anything we control, so this looks instead of
 * assuming a path.
 */
function installedChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base) return [];

  const layouts = [
    join('chrome-linux', 'chrome'),
    join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
    join('Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  ];

  const found = [];
  let entries = [];
  try {
    entries = readdirSync(base);
  } catch {
    return [];
  }
  for (const entry of entries) {
    for (const layout of layouts) {
      const candidate = join(base, entry, layout);
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(port) {
  const child = spawn(process.execPath, [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (data) => process.stderr.write(`[server] ${data}`));

  return new Promise((resolve, reject) => {
    const failed = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', () => {
      clearTimeout(failed);
      resolve(child);
    });
    child.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
}

/** Tries each Playwright against its own browser, then the installed ones. */
async function launch(playwrights) {
  const executables = installedChromium();
  const failures = [];

  for (const playwright of playwrights) {
    for (const executablePath of [undefined, ...executables]) {
      try {
        return await playwright.chromium.launch(
          executablePath ? { executablePath } : {},
        );
      } catch (err) {
        failures.push(`${executablePath || 'bundled'}: ${err.message.split('\n')[0]}`);
      }
    }
  }

  throw new Error(
    'could not launch Chromium. Tried:\n  ' + failures.join('\n  ') +
    '\nIf Playwright was just installed, run: npx playwright install chromium',
  );
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const pdfPath = join(OUT, 'fixture.pdf');
  await writeFile(pdfPath, makePdf({ pages: FIXTURE_PAGES, title: FIXTURE_TITLE }));
  console.log(`fixture: ${FIXTURE_PAGES}-page PDF written`);

  const playwrights = await loadPlaywrights();
  const port = await freePort();
  const server = await startServer(port);
  const browser = await launch(playwrights);

  const problems = [];

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    // A page error means the module graph is broken; that must fail the run
    // rather than show up as a mysterious timeout later.
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // A 404 from the stub State API is the correct answer to "is there a
      // bookmark for this learner yet", and the adapters handle it as such.
      // The browser still logs it, so it must not be mistaken for a fault.
      const from = msg.location()?.url || '';
      if (/\/_lrs\/activities\/state/.test(from)) return;
      // Browsers probe /favicon.ico on any page that declares no icon, and the
      // generated harness scaffolding never will. Not a product signal.
      if (/\/favicon\.ico$/.test(from)) return;
      problems.push(`console error: ${msg.text()} (${from})`);
    });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

    await page.setInputFiles('#file', pdfPath);
    await page.waitForFunction(
      () => !document.getElementById('build').disabled,
      null,
      { timeout: 30000 },
    );

    const meta = await page.textContent('#filemeta');
    console.log(`intake: ${meta.trim()}`);
    if (!meta.includes(`${FIXTURE_PAGES} pages`)) {
      problems.push(`page count not detected, got: ${meta.trim()}`);
    }

    const title = await page.inputValue('#title');
    if (title !== FIXTURE_TITLE) {
      problems.push(`title not read from PDF metadata, got: ${JSON.stringify(title)}`);
    }

    // Exercise the options that change the output shape.
    await page.fill('#identifier', 'fixture-course');
    await page.fill('#activity-iri', 'https://example.com/courses/fixture');
    await page.fill('#mastery', '80');
    await page.selectOption('#format', 'image/png');

    await page.click('#build');
    await page.waitForSelector('#results:not([hidden])', { timeout: 120000 });

    const label = await page.textContent('#progress-label');
    console.log(`build: ${label.trim()}`);

    const rows = await page.locator('#results-list li').count();
    if (rows !== STANDARDS.length) {
      problems.push(`expected ${STANDARDS.length} packages, got ${rows}`);
    }

    for (let i = 0; i < rows; i++) {
      const row = page.locator('#results-list li').nth(i);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        row.locator('button.dl').click(),
      ]);
      const name = download.suggestedFilename();
      await download.saveAs(join(OUT, name));
      console.log(`saved: ${name}`);
    }

    const errorVisible = await page.locator('#error:not([hidden])').count();
    if (errorVisible) {
      problems.push(`UI reported an error: ${await page.textContent('#error')}`);
    }

    // Second pass with the schema files included. The default is off, so both
    // paths need exercising: the conditional xsi:schemaLocation is only
    // correct if the files it points at are actually there.
    await mkdir(join(OUT, 'withschemas'), { recursive: true });
    // The option lives in a folded "Advanced" section, so open it the way a
    // person would rather than reaching past the UI.
    await page.click('#schemas-row > summary');
    await page.check('#include-schemas');
    await page.click('#build');
    await page.waitForSelector('#results:not([hidden])', { timeout: 120000 });

    const schemaRows = await page.locator('#results-list li').count();
    for (let i = 0; i < schemaRows; i++) {
      const row = page.locator('#results-list li').nth(i);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        row.locator('button.dl').click(),
      ]);
      const name = download.suggestedFilename();
      await download.saveAs(join(OUT, 'withschemas', name));
    }
    console.log(`saved: ${schemaRows} packages with schema files`);
    await page.uncheck('#include-schemas');
    await page.click('#schemas-row > summary');

    // Third pass in Czech, so the localisation is actually exercised: the
    // player's labels are resolved at build time and baked into the package,
    // which means a broken table produces a silently English course.
    await mkdir(join(OUT, 'czech'), { recursive: true });
    await page.selectOption('#ui-language', 'cs');
    await page.selectOption('#language', 'cs');

    const buildLabel = await page.textContent('#build');
    if (!buildLabel.includes('Vytvořit')) {
      problems.push(`converter UI did not switch to Czech, button reads: ${buildLabel.trim()}`);
    }

    await page.click('#build');
    await page.waitForSelector('#results:not([hidden])', { timeout: 120000 });

    const czechRows = await page.locator('#results-list li').count();
    for (let i = 0; i < czechRows; i++) {
      const row = page.locator('#results-list li').nth(i);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        row.locator('button.dl').click(),
      ]);
      await download.saveAs(join(OUT, 'czech', download.suggestedFilename()));
    }
    console.log(`saved: ${czechRows} packages in Czech`);
    await page.selectOption('#ui-language', 'en');
    await page.selectOption('#language', 'en');

    if (!problems.length) {
      // Loading the built SCOs against a mock API is the only way to catch a
      // player that packages cleanly but never reports anything.
      console.log('\nrun-time stage');
      const base = `http://127.0.0.1:${port}`;
      problems.push(...await testPlayer(page, OUT, base, FIXTURE_PAGES));
      // xAPI and cmi5 have no API object to mock, so they are driven through
      // the harness against the stub LRS instead.
      problems.push(...await testStatements(page, OUT, ROOT, base, FIXTURE_PAGES));
      // The single-file variant needs its own context: it must be opened as a
      // real file:// document, not served.
      problems.push(...await testSingleFile(browser, OUT, ROOT, pdfPath, FIXTURE_PAGES));
    }
  } finally {
    await browser.close();
    server.kill();
  }

  if (problems.length) {
    console.error('\nBROWSER STAGE FAILED');
    problems.forEach((line) => console.error(`  - ${line}`));
    process.exit(1);
  }
  console.log('\nbrowser stages passed; verifying package structure\n');

  const verify = spawn('python3', [join(HERE, 'verify.py'), OUT, String(FIXTURE_PAGES)], {
    stdio: 'inherit',
  });
  verify.on('exit', (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
