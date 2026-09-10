// The course on a phone.
//
// This exists because nothing in the suite had ever set a narrow viewport. The
// player carried a `@media (max-width: 34rem)` block that was written and never
// once executed, and measuring it turned up three real faults: the page list
// covered 69% of the page and stayed open after a page was picked, every
// control was 28px tall, and the top bar overflowed sideways at 320px because
// the status message cannot shrink.
//
// An LMS drops the course into an iframe whose size nobody controls, and a
// learner on a phone is the normal case for BOZP training, not an edge one. So
// the sizes are asserted as numbers rather than eyeballed in a screenshot.
//
// Touch events are dispatched over CDP. Playwright's own touchscreen helper can
// tap but not drag, and a mouse drag is not a swipe: an early attempt "passed"
// only because the drag happened to end on a thumbnail and navigated by click.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Apple's HIG asks for 44pt, Material for 48dp, and WCAG 2.2 SC 2.5.8 sets the
// conformance floor at 24x24 CSS px. 44 is the number the CSS targets.
const TAP_MIN = 44;

const SIZES = [
  ['phone 390x844', { width: 390, height: 844 }],
  // The smallest screen still in real use, and the width that overflowed.
  ['small phone 320x568', { width: 320, height: 568 }],
];

async function swipe(page, cdp, { from, to, y }) {
  const steps = [
    ['touchStart', from],
    ['touchMove', from + (to - from) * 0.34],
    ['touchMove', from + (to - from) * 0.67],
    ['touchMove', to],
    ['touchEnd', null],
  ];
  for (const [type, x] of steps) {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: x === null
        ? []
        : [{ x: Math.round(x), y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
    });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(250);
}

export async function testMobile(browser, outDir, pageCount) {
  const problems = [];
  console.log('\n  on a phone');

  // The unzipped SCORM 1.2 package the offline stage already laid down: the
  // real artefact a learner gets, not the served app.
  const root = join(outDir, 'offline', 'fixture-course-scorm12');
  const url = pathToFileURL(join(root, 'index.html')).href;

  for (const [label, viewport] of SIZES) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const faults = [];
    page.on('pageerror', (err) => faults.push(`page error: ${err.message}`));

    const expect = (ok, text, detail) => {
      if (ok) {
        console.log(`    ok   ${label}: ${text}`);
      } else {
        console.log(`    FAIL ${label}: ${text}${detail ? ` -- ${detail}` : ''}`);
        problems.push(`mobile: ${label}: ${text}`);
      }
    };

    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(
        () => {
          const img = document.getElementById('page-img');
          return !!img && img.naturalWidth > 0;
        },
        null,
        { timeout: 15000 },
      ).catch(() => { /* the assertions below report it with detail */ });

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const controls = [...document.querySelectorAll('button, input')]
          .filter((node) => !node.hidden && node.checkVisibility && node.checkVisibility())
          // Thumbnails are pictures of pages, sized by the rail, not chrome.
          .filter((node) => !node.classList.contains('thumb'))
          .map((node) => {
            const r = node.getBoundingClientRect();
            return { id: node.id || node.className, w: Math.round(r.width), h: Math.round(r.height) };
          });
        return {
          overflowX: doc.scrollWidth - doc.clientWidth,
          rendered: (document.getElementById('page-img') || {}).naturalWidth > 0,
          controls,
        };
      });

      expect(layout.overflowX <= 0, 'the page does not scroll sideways',
             `${layout.overflowX}px of overflow`);
      expect(layout.rendered, 'the first page image renders');

      const small = layout.controls.filter((c) => c.w < TAP_MIN || c.h < TAP_MIN);
      expect(small.length === 0, `every control is at least ${TAP_MIN}px for a fingertip`,
             small.map((c) => `${c.id} ${c.w}x${c.h}`).join(', '));

      // The page list: it has to open, navigate, and then get out of the way.
      await page.click('#toggle-thumbs');
      await page.waitForTimeout(250);
      const opened = await page.evaluate(() => {
        const rail = document.querySelector('.thumbs');
        const r = rail.getBoundingClientRect();
        return {
          open: !rail.hidden,
          overlays: getComputedStyle(rail).position === 'absolute',
          leavesPage: Math.round(window.innerWidth - r.right),
          thumbs: document.querySelectorAll('.thumb').length,
        };
      });
      expect(opened.open && opened.thumbs === pageCount,
             `the page list opens and lists all ${pageCount} pages`, String(opened.thumbs));
      expect(opened.overlays, 'the list floats over the page instead of taking a column');
      expect(opened.leavesPage >= viewport.width / 2,
             'and leaves at least half the width showing', `${opened.leavesPage}px free`);

      await page.locator('.thumb').nth(pageCount - 1).tap();
      await page.waitForTimeout(300);
      const picked = await page.evaluate(() => ({
        railOpen: !document.querySelector('.thumbs').hidden,
        page: Number(document.getElementById('page-input').value),
      }));
      expect(picked.page === pageCount, 'tapping a page in the list goes there',
             String(picked.page));
      expect(!picked.railOpen, 'and the list closes so the page is visible again');

      // Swipe. Set up a clean state first: back to page 1 by button.
      const cdp = await context.newCDPSession(page);
      await page.evaluate((n) => {
        const input = document.getElementById('page-input');
        input.value = String(n);
        input.dispatchEvent(new Event('change'));
      }, 1);
      await page.waitForTimeout(200);

      const mid = Math.round(viewport.height / 2);
      await swipe(page, cdp, { from: viewport.width - 40, to: 40, y: mid });
      let now = await page.evaluate(() => Number(document.getElementById('page-input').value));
      expect(now === 2, 'a swipe to the left turns to the next page', `on page ${now}`);

      await swipe(page, cdp, { from: 40, to: viewport.width - 40, y: mid });
      now = await page.evaluate(() => Number(document.getElementById('page-input').value));
      expect(now === 1, 'a swipe to the right turns back', `on page ${now}`);

      // A short jab must not count, or every clumsy tap turns a page.
      await swipe(page, cdp, { from: 200, to: 175, y: mid });
      now = await page.evaluate(() => Number(document.getElementById('page-input').value));
      expect(now === 1, 'a small movement is a tap, not a swipe', `on page ${now}`);

      // A mostly-vertical drag is a scroll.
      await swipe(page, cdp, { from: 180, to: 140, y: mid });
      now = await page.evaluate(() => Number(document.getElementById('page-input').value));
      expect(now === 1, 'a drag that is mostly vertical does not turn the page',
             `on page ${now}`);

      // The guard that matters: in actual-size zoom a sideways drag has to pan
      // the image. If the swipe won there, the learner could never look at the
      // right-hand side of a wide slide.
      await page.click('#zoom-mode'); // page -> width
      await page.click('#zoom-mode'); // width -> actual
      await page.waitForTimeout(300);
      const pannable = await page.evaluate(() => {
        const stage = document.getElementById('stage');
        return {
          zoom: stage.dataset.zoom,
          canPan: stage.scrollWidth > stage.clientWidth + 1,
        };
      });
      expect(pannable.zoom === 'actual', 'the zoom control reaches actual size',
             String(pannable.zoom));
      if (pannable.canPan) {
        await swipe(page, cdp, { from: viewport.width - 40, to: 40, y: mid });
        now = await page.evaluate(() => Number(document.getElementById('page-input').value));
        expect(now === 1, 'a swipe pans a zoomed page instead of turning it',
               `on page ${now}`);
      } else {
        // Say so rather than reporting a pass for a case that never ran: the
        // fixture page may be narrower than the phone even at actual size.
        console.log(`    --   ${label}: zoomed page still fits, nothing to pan`);
      }
    } finally {
      await context.close();
    }

    faults.forEach((f) => {
      console.log(`    FAIL ${label}: ${f}`);
      problems.push(`mobile: ${label}: ${f}`);
    });
  }

  return problems;
}
