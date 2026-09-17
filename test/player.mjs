// Run-time test for the shipped player.
//
// Package structure is verified separately by verify.py. This stage answers a
// different and more important question: when an LMS actually loads the SCO,
// does the player find the API, report the right data model values, and resume
// where the learner left off?
//
// Each package is unzipped and loaded inside a harness page exposing a
// recording mock of the relevant SCORM API, exactly as an LMS frameset would.
// The harness does not load the SCO on its own -- the test calls __launch()
// once it has seeded the mock's store, which is what makes it possible to
// replay a suspended attempt deterministically.

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readZip } from '../tools/unpack.mjs';

const MOCK = `
window.__calls = [];
window.__store = {};
function rec(fn, args) { window.__calls.push({ fn: fn, args: args }); }

window.__makeScorm12 = function () {
  return {
    LMSInitialize: function (p) { rec('LMSInitialize', [p]); return 'true'; },
    LMSFinish: function (p) { rec('LMSFinish', [p]); return 'true'; },
    LMSGetValue: function (k) { rec('LMSGetValue', [k]); return window.__store[k] || ''; },
    LMSSetValue: function (k, v) {
      rec('LMSSetValue', [k, v]);
      window.__store[k] = String(v);
      return 'true';
    },
    LMSCommit: function (p) { rec('LMSCommit', [p]); return 'true'; },
    LMSGetLastError: function () { return '0'; },
    LMSGetErrorString: function () { return 'No error'; },
    LMSGetDiagnostic: function () { return ''; }
  };
};

window.__makeScorm2004 = function () {
  return {
    Initialize: function (p) { rec('Initialize', [p]); return 'true'; },
    Terminate: function (p) { rec('Terminate', [p]); return 'true'; },
    GetValue: function (k) { rec('GetValue', [k]); return window.__store[k] || ''; },
    SetValue: function (k, v) {
      rec('SetValue', [k, v]);
      window.__store[k] = String(v);
      return 'true';
    },
    Commit: function (p) { rec('Commit', [p]); return 'true'; },
    GetLastError: function () { return '0'; },
    GetErrorString: function () { return 'No error'; },
    GetDiagnostic: function () { return ''; }
  };
};
`;

function harness(standard, folder) {
  const install = standard === 'scorm12'
    ? 'window.API = window.__makeScorm12();'
    : 'window.API_1484_11 = window.__makeScorm2004();';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${standard} harness</title></head>
<body style="margin:0">
<iframe id="sco" title="SCO" style="width:1000px;height:760px;border:0"></iframe>
<script>${MOCK}
${install}
// Deliberately not auto-loaded: the test seeds the mock store first.
window.__launch = function () {
  document.getElementById('sco').src = './${folder}/index.html';
};
</script>
</body></html>
`;
}

/** Loads the harness, seeds the mock, launches the SCO and returns its Frame. */
async function launch(page, url, pageCount, seed) {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate((store) => {
    window.__store = store || {};
    window.__calls = [];
    window.__launch();
  }, seed || null);

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
  return frame;
}

async function readMock(page) {
  return page.evaluate(() => ({ calls: window.__calls, store: window.__store }));
}

export async function testPlayer(page, outDir, baseUrl, pageCount) {
  const problems = [];

  const runDir = join(outDir, 'run');
  await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });

  for (const standard of ['scorm12', 'scorm2004']) {
    const target = join(runDir, standard);
    // Uses the repo's own zip reader rather than the unzip binary, so the suite
    // needs nothing installed and tools/unpack.mjs gets covered too.
    for (const entry of readZip(await readFile(join(outDir, `fixture-course-${standard}.zip`)))) {
      const file = join(target, entry.name);
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, entry.data);
    }
    await writeFile(join(runDir, `${standard}.html`), harness(standard, standard));
  }

  for (const standard of ['scorm12', 'scorm2004']) {
    console.log(`\n  ${standard} run-time`);
    const url = `${baseUrl}/test/output/run/${standard}.html`;

    const expect = (ok, label, detail) => {
      if (ok) {
        console.log(`    ok   ${label}`);
      } else {
        console.log(`    FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
        problems.push(`${standard}: ${label}`);
      }
    };

    // ---- first attempt: read every page ----
    let frame = await launch(page, url, pageCount);

    const status = await frame.textContent('#lms-status');
    expect(/Connected/.test(status), 'player found the LMS API', status);

    for (let n = 2; n <= pageCount; n++) {
      await frame.click('#next');
      await frame.waitForFunction(
        (want) => document.getElementById('page-input').value === want,
        String(n),
      );
    }

    const progress = await frame.textContent('#progress-label');
    expect(progress.includes('100%'), 'reports 100% viewed', progress);

    // The player debounces saves; let the last one land before teardown.
    await page.waitForTimeout(1600);

    // Navigating the iframe away fires pagehide, which is the player's cue to
    // write session_time and call Finish/Terminate.
    await page.evaluate(() => { document.getElementById('sco').src = 'about:blank'; });
    await page.waitForTimeout(900);

    const { calls, store } = await readMock(page);
    const called = (fn) => calls.filter((c) => c.fn === fn).length;

    if (standard === 'scorm12') {
      expect(called('LMSInitialize') === 1, 'LMSInitialize called once',
             String(called('LMSInitialize')));
      expect(called('LMSFinish') === 1, 'LMSFinish called once',
             String(called('LMSFinish')));
      expect(called('LMSCommit') > 0, 'LMSCommit called');

      // Mastery was set to 80% and every page was read, so this is a pass
      // rather than a bare completion.
      expect(store['cmi.core.lesson_status'] === 'passed',
             "lesson_status is 'passed'", store['cmi.core.lesson_status']);
      expect(store['cmi.core.score.raw'] === '100',
             'score.raw uses the 0-100 scale', store['cmi.core.score.raw']);
      expect(store['cmi.core.lesson_location'] === String(pageCount),
             'lesson_location is the last page', store['cmi.core.lesson_location']);
      expect(/^\d+~[A-Za-z0-9+/=]+$/.test(store['cmi.suspend_data'] || ''),
             'suspend_data is page~bitfield', store['cmi.suspend_data']);
      expect((store['cmi.suspend_data'] || '').length <= 4096,
             'suspend_data is within the 4096-character limit');
      expect(/^\d{2,4}:\d{2}:\d{2}(\.\d{1,2})?$/.test(store['cmi.core.session_time'] || ''),
             'session_time is CMITimespan HHHH:MM:SS', store['cmi.core.session_time']);
      expect(store['cmi.core.exit'] === '',
             'exit is empty for a completed attempt',
             JSON.stringify(store['cmi.core.exit']));

      // An attempt that was opened but abandoned must not read as never opened.
      const first = calls.find(
        (c) => c.fn === 'LMSSetValue' && c.args[0] === 'cmi.core.lesson_status');
      expect(first && first.args[1] === 'incomplete',
             "lesson_status set to 'incomplete' on entry",
             first ? first.args[1] : 'never set');
    } else {
      expect(called('Initialize') === 1, 'Initialize called once',
             String(called('Initialize')));
      expect(called('Terminate') === 1, 'Terminate called once',
             String(called('Terminate')));
      expect(store['cmi.completion_status'] === 'completed',
             "completion_status is 'completed'", store['cmi.completion_status']);
      expect(store['cmi.success_status'] === 'passed',
             "success_status is 'passed'", store['cmi.success_status']);
      expect(store['cmi.score.scaled'] === '1.0000',
             'score.scaled uses the -1..1 scale', store['cmi.score.scaled']);
      // SCORM 2004 types this as a real, so any representation of 1 is valid.
      expect(Number(store['cmi.progress_measure']) === 1,
             'progress_measure reaches 1', store['cmi.progress_measure']);
      expect(store['cmi.location'] === String(pageCount),
             'location is the last page', store['cmi.location']);
      expect(/^PT(\d+H)?(\d+M)?(\d+S)?$/.test(store['cmi.session_time'] || '')
             && store['cmi.session_time'] !== 'PT',
             'session_time is an ISO 8601 duration', store['cmi.session_time']);
      expect(store['cmi.exit'] === 'normal',
             "exit is 'normal' for a completed attempt", store['cmi.exit']);
    }

    // ---- second attempt: the learner returns ----
    // Seeding the mock with what the first attempt wrote is exactly the state
    // an LMS would hand back on re-entry.
    frame = await launch(page, url, pageCount, store);
    await page.waitForTimeout(700);

    const resumedPage = await frame.inputValue('#page-input');
    const resumedProgress = await frame.textContent('#progress-label');

    expect(Number(resumedPage) === pageCount,
           `resumes on page ${pageCount}`, resumedPage);
    expect(resumedProgress.includes('100%'),
           'restores the set of pages already viewed', resumedProgress);
  }

  return problems;
}
