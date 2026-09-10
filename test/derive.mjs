#!/usr/bin/env node
// The rules that decide what a PDF is, checked directly.
//
// These run in plain Node with no browser, because that is the only way to
// cover the awkward cases properly: a junk /Title, a heading split into glyphs,
// a scan with a text cover page. Driving all of that through a real PDF in a
// real browser would mean hand-building a dozen fixtures to test string rules.
//
// The cases marked "real" came out of an actual document that got this wrong.

import {
  cleanMetaTitle, courseLanguage, courseTitle, failureKey, hasTextLayer,
  headingFromRuns, isUsableHeading, isUsableTitle, samplePages, titleFromFilename,
} from '../app/derive.js';

let checks = 0;
const failures = [];

function check(ok, label, detail) {
  checks++;
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
    failures.push(label);
  }
}

function eq(actual, expected, label) {
  check(actual === expected, label, `got ${JSON.stringify(actual)}`);
}

console.log('\ntitle from a file name');
eq(titleFromFilename('Bezpečnost práce 2026.pdf'), 'Bezpečnost práce 2026',
   'leaves a name that was already fine');
eq(titleFromFilename('GDPR_skoleni_2026_v2.pdf'), 'GDPR skoleni 2026 v2',
   'underscores become spaces');
eq(titleFromFilename('smlouva.o.dilo.pdf'), 'smlouva o dilo',
   'dotted names become spaced');
eq(titleFromFilename('20260810_DG_GCT_Direct_Impact_system.pdf'),
   '20260810 DG GCT Direct Impact system',
   'real: the name the reporter saw as a course title');
eq(titleFromFilename('.pdf'), '.pdf', 'never returns nothing');

console.log('\ncleaning a /Title');
eq(cleanMetaTitle('Microsoft Word - GDPR_skoleni.docx'), 'GDPR skoleni',
   'strips the producer prefix and the source extension');
eq(cleanMetaTitle('Microsoft PowerPoint - Q3 review.pptx'), 'Q3 review',
   'same for PowerPoint');
eq(cleanMetaTitle('  Bezpečnost   práce  '), 'Bezpečnost práce',
   'collapses whitespace');
eq(cleanMetaTitle('Smith Ltd. v. Jones'), 'Smith Ltd. v. Jones',
   'leaves full stops alone in a real title');
eq(cleanMetaTitle(undefined), '', 'a missing title is empty, not "undefined"');
eq(cleanMetaTitle(null), '', 'so is null');

console.log('\nwhich /Title values are worth using');
const junk = [
  '', '  ', 'Untitled', 'untitled', 'Untitled 1', 'Document', 'Document2',
  'Presentation1', 'Prezentace', 'Bez názvu', 'Sans titre', 'Unbenannt',
  'output', 'scan', 'Final', 'kopie', '2026', '10/08/2026', 'v2.1',
  'd41d8cd98f00b204e9800998ecf8427e',
  '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  'ab',
];
for (const value of junk) {
  check(!isUsableTitle(cleanMetaTitle(value), 'whatever.pdf'),
        `rejects ${JSON.stringify(value)}`);
}
const good = [
  'Bezpečnost práce 2026', 'Direct Impact culture', 'GDPR pro personalisty',
  'Q3 review', '2026 Annual Report', 'Onboarding',
  'Zásady ochrany osobních údajů',
];
for (const value of good) {
  check(isUsableTitle(cleanMetaTitle(value), 'whatever.pdf'),
        `keeps ${JSON.stringify(value)}`);
}
// Caught from a screenshot: a /Title of "Skoleni BOZP 2026" in a file called
// Skoleni_BOZP_2026.pdf was being thrown away as "adding nothing", and the
// course got named after the biggest text on page one instead.
check(isUsableTitle('kurz gdpr', 'kurz_gdpr.pdf'),
      'keeps a title that agrees with the file name -- agreement is not junk');
eq(courseTitle({ metaTitle: 'Skoleni BOZP 2026', heading: 'Fixture page 1',
                 filename: 'Skoleni_BOZP_2026.pdf' }).title,
   'Skoleni BOZP 2026', 'real: and the page heading does not get to overrule it');
check(!isUsableTitle('x'.repeat(200), 'a.pdf'),
      'rejects a title too long to name a file with');

console.log('\nheading from the largest type on the page');
// Real cover pages, from three documents this was tested against.
eq(headingFromRuns([
  { str: 'Pojištění', size: 80.4, eol: true }, { str: 'podnikání', size: 80.4, eol: true },
  { str: 'Produktové školení', size: 48.1, eol: true },
]), 'Pojištění podnikání',
   'real: one phrase wrapped across two lines joins with a space');

// Exactly the item shape pdf.js produced for that cover: the line end arrives
// as its own empty item, and the dash is a run of its own.
eq(headingFromRuns([
  { str: 'Produktový den', size: 48.1 },
  { str: '', size: 48.1, eol: true },
  { str: 'Odpovědnost', size: 48.1 }, { str: ' ', size: 48.1 },
  { str: '–', size: 48.1 }, { str: ' ', size: 48.1 },
  { str: 'výrobek, služba', size: 48.1 },
]), 'Produktový den – Odpovědnost – výrobek, služba',
   'real: two stacked phrases are separated, not run together');

eq(headingFromRuns([
  { str: 'Direct', size: 48.1 }, { str: 'Impact', size: 48.1 }, { str: 'culture', size: 48.1 },
  { str: '… the place where people create the value …', size: 24 },
  { str: 'GC', size: 18 }, { str: 'T', size: 18 }, { str: ', 10 of August 2026', size: 18 },
]), 'Direct Impact culture', 'real: the measured runs from the reporter\'s PDF');

eq(headingFromRuns([
  { str: 'B', size: 40 }, { str: 'e', size: 40 }, { str: 'z', size: 40 },
  { str: 'p', size: 40 }, { str: 'e', size: 40 }, { str: 'č', size: 40 },
  { str: 'í', size: 40 }, { str: 'n', size: 40 },
]), 'Bezpečín', 'joins without spaces when the run arrived as single glyphs');

eq(headingFromRuns([
  { str: 'Page 4', size: 60 },
  { str: 'Skutečný název kurzu', size: 30 },
]), 'Skutečný název kurzu', 'walks down past page furniture set in bigger type');

eq(headingFromRuns([{ str: '2026', size: 60 }, { str: 'Roční přehled', size: 20 }]),
   'Roční přehled', 'walks down past a bare year');
eq(headingFromRuns([]), '', 'no runs, no heading');
eq(headingFromRuns([{ str: '   ', size: 30 }]), '', 'whitespace is not a heading');
check(!isUsableHeading('Slide 12'), 'rejects a slide number as a heading');
check(!isUsableHeading('str. 3'), 'rejects a Czech page marker');

console.log('\nchoosing the course title');
let picked = courseTitle({
  metaTitle: '', heading: 'Direct Impact culture',
  filename: '20260810_DG_GCT_Direct_Impact_system.pdf',
});
eq(picked.title, 'Direct Impact culture', 'real: the reporter\'s PDF gets its heading');
eq(picked.source, 'page', 'and says where that came from');

picked = courseTitle({
  metaTitle: 'Bezpečnost práce 2026', heading: 'Něco jiného', filename: 'x.pdf',
});
eq(picked.title, 'Bezpečnost práce 2026', 'a good /Title beats the page');
eq(picked.source, 'metadata', 'and is reported as metadata');

picked = courseTitle({ metaTitle: 'Presentation1', heading: 'Úvod do GDPR', filename: 'x.pdf' });
eq(picked.title, 'Úvod do GDPR', 'a junk /Title loses to the page');

// The case that got through the first time: it cleans up to something that
// looks like a perfectly good title and tells a learner nothing.
picked = courseTitle({
  metaTitle: 'Microsoft Word - export_final_v2.docx',
  heading: 'Úvod do GDPR', filename: 'x.pdf',
});
eq(picked.title, 'Úvod do GDPR', 'a /Title that is really a file name loses to the page');
eq(picked.source, 'page', 'and the page is credited');

picked = courseTitle({
  metaTitle: 'Microsoft Word - Skoleni_GDPR.docx', heading: '', filename: 'x.pdf',
});
eq(picked.title, 'Skoleni GDPR',
   'but it still beats the file in hand when the page offers nothing');
eq(picked.source, 'filename', 'and is honestly reported as a file name');

picked = courseTitle({ metaTitle: 'Untitled', heading: '', filename: 'GDPR_2026.pdf' });
eq(picked.title, 'GDPR 2026', 'with neither, the file name is tidied');
eq(picked.source, 'filename', 'and reported as such');

console.log('\ncourse language from the document');
const available = ['en', 'cs'];
eq(courseLanguage('en', available), 'en', 'real: the reporter\'s PDF declares en');
eq(courseLanguage('en-GB', available), 'en', 'region is dropped');
eq(courseLanguage('CS', available), 'cs', 'case does not matter');
eq(courseLanguage('cs_CZ', available), 'cs', 'underscores are a tag separator too');
eq(courseLanguage('de', available), null, 'a language we do not ship keeps the default');
eq(courseLanguage('', available), null, 'no declaration keeps the default');
eq(courseLanguage(undefined, available), null, 'nor does a missing one throw');

console.log('\ntext layer, and which pages to look at');
check(hasTextLayer(1805, 5), 'real: the reporter\'s PDF has a text layer');
check(!hasTextLayer(0, 5), 'a scan with no text has none');
check(!hasTextLayer(12, 5), 'a stray page number is not a text layer');
check(hasTextLayer(120, 3), 'a short document with real text counts');
check(!hasTextLayer(500, 0), 'nothing sampled means no claim');
eq(JSON.stringify(samplePages(3)), '[1,2,3]', 'a short document is sampled whole');
eq(JSON.stringify(samplePages(14)), '[1,4,8,11,14]',
   'a longer one is sampled across, not just the front');
eq(JSON.stringify(samplePages(0)), '[]', 'no pages, no samples');

console.log('\nwhat a failure from pdf.js means');
// Only the mapping is covered here. Building an encrypted PDF by hand to drive
// the locked path through a real browser is a lot of work for a two-line rule,
// so this is checked directly and the gap is stated rather than hidden.
eq(failureKey({ name: 'PasswordException', message: 'No password given' }),
   'source.locked', 'a password-protected file is named as such');
eq(failureKey({ name: 'InvalidPDFException', message: 'Invalid PDF structure' }),
   'source.corrupt', 'so is a damaged one');
eq(failureKey({ message: 'Incorrect password' }), 'source.locked',
   'falls back to the message when the class name did not survive');
eq(failureKey({ message: 'Invalid PDF structure.' }), 'source.corrupt',
   'same for a damaged file');
eq(failureKey({ name: 'Error', message: 'worker died' }), null,
   'anything else keeps its own message');
eq(failureKey(null), null, 'and nothing thrown at all does not throw here');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:`);
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exit(1);
}
