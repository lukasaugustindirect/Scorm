// Drives the real converter against PDFs that are not the happy case.
//
// The rules themselves are covered in test/derive.mjs, which is plain Node.
// This is the wiring: that peek() really reads /Lang out of a catalog, that the
// heading really comes off page one through pdf.js's own text layer, that a
// page with no text operators really reads as a scan, and that the interface
// says so and switches the affected option off.
//
// Every case here started as something a real document did. Nobody should have
// to know whether their PDF carries a /Title.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { makePdf } from './fixture.mjs';

/**
 * @typedef {object} Case
 * @property {string} name
 * @property {object} pdf         options for makePdf
 * @property {string} ui          interface language to convert in
 * @property {object} expect      what the interface should end up showing
 */

/**
 * The interface language is Czech throughout, so a switch to en is visible.
 *
 * Headings here are ASCII on purpose. makePdf draws with base-14 Helvetica and
 * serialises as latin1, so it cannot put a Czech caron into a content stream at
 * all -- that path is covered instead by the /Title of the main fixture, which
 * is written as a UTF-16 string and asserted all the way into the manifests.
 */
const CASES = [
  {
    name: 'no /Title, heading on page one',
    pdf: { title: null, heading: 'Safety at work 2026' },
    ui: 'cs',
    expect: {
      title: 'Safety at work 2026',
      language: 'cs',
      extractText: true,
      notice: /první stránky/,
    },
  },
  {
    name: 'a title Word wrote for itself',
    pdf: { title: 'Microsoft Word - export_final_v2.docx', heading: 'Introduction to GDPR' },
    ui: 'cs',
    expect: {
      title: 'Introduction to GDPR',
      language: 'cs',
      extractText: true,
      notice: /první stránky/,
    },
  },
  {
    name: 'a title worth keeping',
    pdf: { title: 'Zasady ochrany osobnich udaju', heading: 'Something else entirely' },
    ui: 'cs',
    expect: {
      title: 'Zasady ochrany osobnich udaju',
      language: 'cs',
      extractText: true,
      // Nothing was guessed, so there is nothing to explain.
      noNotice: /první stránky|název souboru/,
    },
  },
  {
    name: 'nothing to go on but the file name',
    pdf: { title: null, heading: 'Slide 1' },
    ui: 'cs',
    // makePdf still draws "Fixture page 1" at 28pt, so the heading has to be
    // rejected for the file name to win: 'Slide 1' is page furniture and
    // 'Fixture page 1' is not, which is why this case names the file instead.
    expect: { language: 'cs', extractText: true },
  },
  {
    name: 'an English document in a Czech interface',
    pdf: { title: null, language: 'en-GB', heading: 'Health and Safety' },
    ui: 'cs',
    expect: {
      title: 'Health and Safety',
      language: 'en',
      extractText: true,
      notice: /angličtině/,
    },
  },
  {
    name: 'a scan, with no text to attach',
    pdf: { title: null, text: false },
    ui: 'cs',
    expect: {
      language: 'cs',
      // Switched off by the tool: there is nothing to extract.
      extractText: false,
      notice: /naskenovan/,
    },
  },
  {
    name: 'a damaged file',
    pdf: { title: 'Whatever' },
    corrupt: true,
    ui: 'cs',
    expect: { error: /poškozené/ },
  },
];

export async function testAwkward(page, outDir, base) {
  const problems = [];
  console.log('\n  PDFs that are not the happy case');

  const dir = join(outDir, 'awkward');
  await mkdir(dir, { recursive: true });

  for (const testCase of CASES) {
    const file = join(dir, `${testCase.name.replace(/[^\w]+/g, '-')}.pdf`);
    let bytes = makePdf({ pages: 3, ...testCase.pdf });
    if (testCase.corrupt) {
      // Truncating past the cross-reference table is the commonest way a real
      // PDF arrives broken: an interrupted download or a truncated upload.
      bytes = bytes.subarray(0, Math.floor(bytes.length * 0.6));
    }
    await writeFile(file, bytes);

    const expected = testCase.expect;
    const expect = (ok, label, detail) => {
      if (ok) {
        console.log(`    ok   ${testCase.name}: ${label}`);
      } else {
        console.log(`    FAIL ${testCase.name}: ${label}${detail ? ` -- ${detail}` : ''}`);
        problems.push(`awkward: ${testCase.name}: ${label}`);
      }
    };

    // A fresh load of the converter each time. Not reload(): earlier stages
    // navigate this same page to the harness, so reload would reopen whichever
    // page happened to be last. And a fresh load matters -- the title field is
    // only filled when empty, deliberately, so state must not carry over.
    await page.goto(`${base}/`, { waitUntil: 'load' });
    await page.selectOption('#ui-language', testCase.ui);
    await page.setInputFiles('#file', file);

    if (expected.error) {
      await page.waitForSelector('#error:not([hidden])', { timeout: 60000 })
        .catch(() => { /* reported below */ });
      const shown = await page.locator('#error:not([hidden])').count()
        ? (await page.textContent('#error')).trim()
        : '';
      expect(expected.error.test(shown), 'is refused with a sentence you can act on',
             shown || 'no error shown');
      expect(!/\[object|undefined|Error:/.test(shown),
             'and not with a raw exception', shown);
      continue;
    }

    await page.waitForFunction(
      () => !document.getElementById('build').disabled, null, { timeout: 120000 },
    ).catch(() => { /* reported by the assertions below */ });

    const state = await page.evaluate(() => ({
      title: document.getElementById('title').value,
      language: document.getElementById('language').value,
      extractText: document.getElementById('extract-text').checked,
      notices: [...document.querySelectorAll('#notices li')].map((li) => li.textContent),
      error: document.getElementById('error').hidden
        ? '' : document.getElementById('error').textContent,
    }));
    const notices = state.notices.join(' | ');

    expect(!state.error, 'converts without an error', state.error);

    if (expected.title !== undefined) {
      expect(state.title === expected.title, `names the course "${expected.title}"`,
             JSON.stringify(state.title));
    } else {
      // No expected title means "whatever it is, it must not be empty and must
      // not be the raw file name with its separators".
      expect(state.title.length > 0 && !state.title.includes('_'),
             'names the course something tidy', JSON.stringify(state.title));
    }

    expect(state.language === expected.language,
           `sets the course language to ${expected.language}`, state.language);
    expect(state.extractText === expected.extractText,
           `leaves the page-text option ${expected.extractText ? 'on' : 'off'}`,
           String(state.extractText));

    if (expected.notice) {
      expect(expected.notice.test(notices), 'says what it worked out',
             notices || 'no notices');
    }
    if (expected.noNotice) {
      expect(!expected.noNotice.test(notices), 'explains nothing it did not guess',
             notices);
    }
  }

  return problems;
}
