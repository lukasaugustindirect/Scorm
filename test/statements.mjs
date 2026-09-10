// Run-time test for the xAPI and cmi5 adapters.
//
// These two cannot be checked the way SCORM is: there is no API object in the
// parent window, only HTTP traffic to an LRS. So the test drives the real
// harness page (harness/) against the stub LRS in server.js, which performs the
// cmi5 launch handshake properly -- LMS.LaunchData written to the State API,
// a one-time fetch URL for the auth token, launch parameters on the query
// string -- and then reads back every statement the course recorded.
//
// The assertions are the cmi5 obligations that are easy to get wrong and
// invisible without a real LRS: statement order, durations, the two category
// activities, the session id carried through from contextTemplate, UUID
// statement ids, and the silence required in Browse and Review mode.

import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readZip } from '../tools/unpack.mjs';

const CMI5_CATEGORY = 'https://w3id.org/xapi/cmi5/context/categories/cmi5';
const MOVEON_CATEGORY = 'https://w3id.org/xapi/cmi5/context/categories/moveon';
const SESSION_EXT = 'https://w3id.org/xapi/cmi5/context/extensions/sessionid';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DURATION = /^PT(?:\d+H)?(?:\d+M)?(?:\d+S)?$/;

/** Unpacks a built zip into packages/, where the harness and server find it. */
async function unpack(zipPath, target) {
  await rm(target, { recursive: true, force: true });
  for (const entry of readZip(await readFile(zipPath))) {
    const file = join(target, entry.name);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, entry.data);
  }
}

function categoriesOf(statement) {
  const list = statement.context?.contextActivities?.category || [];
  return list.map((activity) => activity.id);
}

function verbOf(statement) {
  return String(statement.verb?.id || '').split('/').pop();
}

async function pageThrough(page, pageCount) {
  const handle = await page.waitForSelector('#sco');
  const frame = await handle.contentFrame();
  await frame.waitForFunction(
    (total) => {
      const el = document.getElementById('page-total');
      return el && el.textContent === total;
    },
    String(pageCount),
    { timeout: 30000 },
  );

  for (let n = 2; n <= pageCount; n++) {
    await frame.click('#next');
    await frame.waitForFunction(
      (want) => document.getElementById('page-input').value === want,
      String(n),
    );
  }
  return frame;
}

async function statements(baseUrl) {
  const response = await fetch(`${baseUrl}/_lrs/statements`);
  const body = await response.json();
  return body.statements || [];
}

export async function testStatements(page, outDir, repoRoot, baseUrl, pageCount) {
  const problems = [];
  const packagesDir = join(repoRoot, 'packages');

  const targets = {
    xapi: join(packagesDir, 'test-xapi'),
    cmi5: join(packagesDir, 'test-cmi5'),
  };
  for (const [standard, target] of Object.entries(targets)) {
    await unpack(join(outDir, `fixture-course-${standard}.zip`), target);
  }

  try {
    for (const standard of ['xapi', 'cmi5']) {
      console.log(`\n  ${standard} run-time (via the harness and stub LRS)`);

      const expect = (ok, label, detail) => {
        if (ok) {
          console.log(`    ok   ${label}`);
        } else {
          console.log(`    FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
          problems.push(`${standard}: ${label}`);
        }
      };

      await fetch(`${baseUrl}/_lrs/reset`, { method: 'POST' });
      await page.goto(`${baseUrl}/harness/`, { waitUntil: 'load' });
      await page.selectOption('#package', `test-${standard}`);
      await page.click('#launch');

      const frame = await pageThrough(page, pageCount);

      const status = await frame.textContent('#lms-status');
      expect(/Connected/.test(status), 'player connected to the LRS', status);

      // cmi5 supplies a returnURL in its launch data; plain xAPI does not.
      const returnVisible = await frame.locator('#return-lms').isVisible();
      expect(returnVisible === (standard === 'cmi5'),
             standard === 'cmi5'
               ? 'return-to-LMS control appears when the LMS supplies a returnURL'
               : 'no return-to-LMS control without a returnURL',
             `visible=${returnVisible}`);

      await page.waitForTimeout(1500);
      // Tearing the iframe down fires pagehide, the player's cue to terminate.
      await page.evaluate(() => { document.getElementById('sco').src = 'about:blank'; });
      await page.waitForTimeout(1200);

      const recorded = await statements(baseUrl);
      const verbs = recorded.map(verbOf);
      console.log(`    (${verbs.join(' -> ')})`);

      expect(recorded.length > 0, 'statements reached the LRS');
      if (!recorded.length) continue;

      expect(verbs[0] === 'initialized', 'first statement is initialized', verbs[0]);
      expect(verbs[verbs.length - 1] === 'terminated',
             'last statement is terminated', verbs[verbs.length - 1]);
      expect(verbs.includes('completed'), 'completion was reported');

      const badIds = recorded.filter((s) => !UUID.test(s.id || ''));
      expect(badIds.length === 0, 'every statement id is a UUID',
             `${badIds.length} were not`);

      // cmi5 requires a duration on completed, passed and failed; the xAPI
      // adapter follows the same practice because it costs nothing.
      for (const verb of ['completed', 'terminated']) {
        const found = recorded.find((s) => verbOf(s) === verb);
        if (!found) continue;
        expect(ISO_DURATION.test(found.result?.duration || ''),
               `${verb} carries an ISO 8601 duration`, found.result?.duration);
      }

      if (standard === 'xapi') {
        // The bug this guards: per-page statements used to ride on the player's
        // debounced save, so a page turned past quickly was never reported.
        const seen = recorded.filter((s) => verbOf(s) === 'experienced');
        expect(seen.length === pageCount,
               `one experienced statement per page (${pageCount})`,
               `got ${seen.length}`);

        const pageIds = new Set(seen.map((s) => s.object.id));
        expect(pageIds.size === pageCount, 'each page statement names a distinct page',
               `${pageIds.size} distinct`);

        const completedAt = verbs.indexOf('completed');
        const lastPageAt = verbs.lastIndexOf('experienced');
        expect(lastPageAt < completedAt,
               'page statements are recorded before completion',
               `last page at ${lastPageAt}, completed at ${completedAt}`);
      }

      if (standard === 'cmi5') {
        const missingCategory = recorded.filter((s) => !categoriesOf(s).includes(CMI5_CATEGORY));
        expect(missingCategory.length === 0,
               'every statement carries the cmi5 category activity',
               `${missingCategory.length} missing`);

        const judged = recorded.filter(
          (s) => s.result && (s.result.completion !== undefined || s.result.success !== undefined));
        const missingMoveOn = judged.filter((s) => !categoriesOf(s).includes(MOVEON_CATEGORY));
        expect(judged.length > 0, 'at least one statement reports completion or success');
        expect(missingMoveOn.length === 0,
               'statements with completion or success carry the moveon category',
               `${missingMoveOn.length} missing`);

        const unjudged = recorded.filter((s) => !judged.includes(s));
        const wrongMoveOn = unjudged.filter((s) => categoriesOf(s).includes(MOVEON_CATEGORY));
        expect(wrongMoveOn.length === 0,
               'other statements do not carry the moveon category',
               `${wrongMoveOn.length} did`);

        // The session id comes from the LMS's contextTemplate, which the AU
        // must reuse without alteration.
        const withoutSession = recorded.filter((s) => !s.context?.extensions?.[SESSION_EXT]);
        expect(withoutSession.length === 0,
               "the LMS session id is carried on every statement",
               `${withoutSession.length} missing`);

        const sessions = new Set(recorded.map((s) => s.context.extensions[SESSION_EXT]));
        expect(sessions.size === 1, 'all statements share one session id',
               `${sessions.size} distinct`);

        expect(verbs.includes('passed'),
               'moveOn of Completed with a mastery score also reports passed');

        // --- Browse mode must record nothing but the bare session ---
        await fetch(`${baseUrl}/_lrs/reset`, { method: 'POST' });
        await page.goto(`${baseUrl}/harness/`, { waitUntil: 'load' });
        await page.selectOption('#package', 'test-cmi5');
        await page.selectOption('#mode', 'Browse');
        await page.click('#launch');

        await pageThrough(page, pageCount);
        await page.waitForTimeout(1500);
        await page.evaluate(() => { document.getElementById('sco').src = 'about:blank'; });
        await page.waitForTimeout(1200);

        const browseVerbs = (await statements(baseUrl)).map(verbOf);
        console.log(`    (Browse mode: ${browseVerbs.join(' -> ') || 'nothing'})`);
        expect(browseVerbs.every((v) => v === 'initialized' || v === 'terminated'),
               'Browse mode records only initialized and terminated',
               browseVerbs.join(', '));
        expect(browseVerbs.includes('initialized') && browseVerbs.includes('terminated'),
               'Browse mode still opens and closes the session',
               browseVerbs.join(', '));
      }
    }
  } finally {
    for (const target of Object.values(targets)) {
      await rm(target, { recursive: true, force: true });
    }
  }

  return problems;
}
