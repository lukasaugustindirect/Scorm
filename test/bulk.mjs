// Several PDFs at once.
//
// Three documents go in together: two that work out to the same title, so the
// identifiers have to be made unique or one package would overwrite the other
// inside a bundle; and one that declares itself English while the interface is
// Czech. Each gets its own row with its own title and language, one title is
// changed in place, and the SCORM 1.2 bundle is opened to check that it holds
// exactly one correctly named package per course, carrying the edited title
// and the document's language.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makePdf } from './fixture.mjs';
import { readZip } from '../tools/unpack.mjs';

export async function testBulk(page, outDir, base) {
  const problems = [];
  const expect = (ok, label, detail) => {
    if (ok) {
      console.log(`    ok   ${label}`);
    } else {
      console.log(`    FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
      problems.push(`bulk: ${label}`);
    }
  };
  console.log('\n  several PDFs at once');

  const dir = join(outDir, 'bulk');
  await mkdir(dir, { recursive: true });

  const files = [
    ['a.pdf', { pages: 2, title: 'Skoleni BOZP' }],
    // No /Title, but the same heading: the tool must not let the two collide.
    ['b.pdf', { pages: 2, title: null, heading: 'Skoleni BOZP' }],
    ['c.pdf', { pages: 3, title: null, language: 'en-GB', heading: 'Fire safety' }],
  ];
  const paths = [];
  for (const [name, options] of files) {
    const path = join(dir, name);
    await writeFile(path, makePdf(options));
    paths.push(path);
  }

  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.selectOption('#ui-language', 'cs');
  // All four formats, so the one-bundle-per-format grouping is really tested.
  await page.click('summary.settings__summary');
  for (const id of ['scorm2004', 'xapi', 'cmi5']) {
    await page.check(`#standards input[value="${id}"]`);
  }
  await page.setInputFiles('#file', paths);
  await page.waitForFunction(
    () => document.querySelectorAll('#queue .queue__row[data-status="ready"]').length === 3
      && !document.getElementById('build').disabled,
    null,
    { timeout: 120000 },
  ).catch(() => { /* reported below */ });

  const intake = await page.evaluate(() => ({
    rows: document.querySelectorAll('#queue .queue__row').length,
    queueShown: !document.getElementById('queue').hidden,
    filemetaHidden: document.getElementById('filemeta').hidden,
    fieldsHidden: document.getElementById('course-fields').hidden,
    noteShown: !document.getElementById('bulk-note').hidden,
    titles: [...document.querySelectorAll('.queue__title')].map((i) => i.value),
    languages: [...document.querySelectorAll('.queue__lang')].map((s) => s.value),
    button: document.getElementById('build').textContent.trim(),
  }));

  expect(intake.rows === 3, 'lists one row per PDF', String(intake.rows));
  expect(intake.queueShown && intake.filemetaHidden,
         'shows the list instead of the single-file line');
  expect(intake.fieldsHidden && intake.noteShown,
         'stands the per-course Settings fields down, with a note');
  expect(JSON.stringify(intake.titles) === JSON.stringify(['Skoleni BOZP', 'Skoleni BOZP', 'Fire safety']),
         'works out each title from its own PDF', JSON.stringify(intake.titles));
  expect(JSON.stringify(intake.languages) === JSON.stringify(['cs', 'cs', 'en']),
         'gives the English document English while the others follow the interface',
         JSON.stringify(intake.languages));
  expect(/3 kurzy/.test(intake.button), 'the button counts the courses, declined',
         intake.button);

  // Change one title in place, the way a person fixing a wrong guess would.
  await page.locator('.queue__title').nth(2).fill('Fire safety 2026');

  await page.click('#build');
  await page.waitForSelector('#results:not([hidden])', { timeout: 300000 });

  const results = await page.evaluate(() => ({
    rows: document.querySelectorAll('#results-list li').length,
    courses: [...document.querySelectorAll('#results-list .results__course')].map((c) => c.textContent),
    formatButtons: document.querySelectorAll('#download-formats button').length,
    downloadAllHidden: document.getElementById('download-all').hidden,
    bundleHintShown: document.getElementById('bundle-hint').checkVisibility(),
    error: document.getElementById('error').hidden ? '' : document.getElementById('error').textContent,
  }));
  expect(!results.error, 'builds the batch without an error', results.error);
  expect(results.rows === 12, 'builds four packages for each of three courses',
         String(results.rows));
  expect(results.formatButtons === 4 && results.downloadAllHidden,
         'offers one bundle per format instead of one for everything',
         `${results.formatButtons} buttons`);
  // Here the bundle IS the download, so the panel has to say that this one
  // gets opened -- the opposite of the advice for a single course package.
  expect(results.bundleHintShown,
         'says that a per-format bundle has to be unzipped for the packages inside');
  const labels = [...new Set(results.courses)];
  expect(labels.length === 3 && labels.includes('Fire safety 2026'),
         'labels each package with its course, including the edited title',
         JSON.stringify(labels));
  // Two courses share a title here, so their labels must still differ: the
  // file name is appended to a repeated title, and only to a repeated one.
  expect(labels.includes('Skoleni BOZP (a.pdf)') && labels.includes('Skoleni BOZP (b.pdf)')
         && !labels.some((l) => l.startsWith('Fire safety 2026 (')),
         'tells two same-titled courses apart by file name, and only those',
         JSON.stringify(labels));

  // The SCORM 1.2 bundle: one package per course, none overwriting another.
  const scorm12Button = page.locator('#download-formats button', { hasText: 'SCORM 1.2' });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    scorm12Button.click(),
  ]);
  const bundlePath = join(dir, download.suggestedFilename());
  await download.saveAs(bundlePath);
  expect(download.suggestedFilename() === 'scorm12-3-courses.zip',
         'names the bundle by format and count', download.suggestedFilename());

  const inner = readZip(await readFile(bundlePath));
  const names = inner.map((e) => e.name).sort();
  expect(JSON.stringify(names) === JSON.stringify([
    'Fire_safety_2026-scorm12.zip', 'Skoleni_BOZP-2-scorm12.zip', 'Skoleni_BOZP-scorm12.zip',
  ]), 'holds one package per course, with colliding identifiers made unique',
     JSON.stringify(names));

  for (const entry of inner) {
    const files = readZip(entry.data);
    const manifest = files.find((f) => f.name === 'imsmanifest.xml');
    const pages = files.find((f) => f.name === 'content/pages.json');
    const titles = manifest
      ? [...manifest.data.toString('utf8').matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1])
      : [];
    const json = pages ? JSON.parse(pages.data.toString('utf8')) : {};
    const wantTitle = entry.name.startsWith('Fire') ? 'Fire safety 2026' : 'Skoleni BOZP';
    const wantLang = entry.name.startsWith('Fire') ? 'en' : 'cs';
    expect(titles.length > 0 && titles.every((x) => x === wantTitle),
           `${entry.name}: manifest carries "${wantTitle}"`, JSON.stringify(titles));
    expect(json.language === wantLang,
           `${entry.name}: course language is ${wantLang}`, String(json.language));
  }

  // Taking one away goes back to two, and the button says so.
  await page.locator('.queue__remove').nth(1).click();
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll('#queue .queue__row').length,
    button: document.getElementById('build').textContent.trim(),
  }));
  expect(after.rows === 2 && /2 kurzy/.test(after.button),
         'removing a file updates the list and the count', `${after.rows}, ${after.button}`);

  return problems;
}
