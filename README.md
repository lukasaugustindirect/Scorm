# PDF to SCORM

Turns a PDF into an e-learning package that an LMS can import and track. One
PDF in, up to four packages out:

| Standard | Manifest | What the course reports back |
| --- | --- | --- |
| SCORM 1.2 | `imsmanifest.xml` | lesson status, bookmark, score, session time |
| SCORM 2004 4th Edition | `imsmanifest.xml` | completion and success separately, progress measure, scaled score |
| xAPI 1.0.3 | `tincan.xml` | `initialized`, one `experienced` per page, `completed`, `terminated` |
| cmi5 | `cmi5.xml` | `initialized`, `completed`, `passed`/`failed`, `terminated` |

The course itself is a page-turner: every PDF page is rendered to an image and
wrapped in a viewer with page navigation, thumbnails, a progress bar, zoom
modes and resume. Its interface is available in English and Czech.

**Everything runs in the browser.** The PDF is read by `pdf.js` in the tab and
zipped by `JSZip` in the tab. It is never uploaded anywhere, and the converter
makes no network calls at all — which is the point if the document is not
something you may hand to a third-party service.

## Using it

pdf.js parses in a Web Worker, and browsers refuse to start a worker from a
`file://` origin, so the page has to be served over HTTP. Any static host will
do; `npm start` exists so you need not install anything:

```sh
npm start            # converter at http://localhost:8080
                     # test harness at http://localhost:8080/harness/
```

or, for the converter alone, without Node:

```sh
python3 -m http.server 8080
```

Then open the page, drop in a PDF, pick your standards and click **Build**.
Once it is on an internal web server, it is just a URL for everyone else.

Nothing needs installing to *use* the converter — `pdf.js` and `JSZip` are
vendored under `vendor/`, so it also works with no internet connection. The
only dependency in `package.json` is Playwright, and that is for the tests.

## What is in a package

```
imsmanifest.xml       (or tincan.xml, or cmi5.xml)
index.html            the player
player.css
player.js
lms-adapter.js        the one adapter for this standard
content/pages.json    page list, geometry, page text, interface strings
content/p001.webp     one image per page
SCORM-schemas/*.xsd   only if you asked for the schema files
```

`lms-adapter.js` is the only file that differs between standards. The player
talks to it through a small interface — `init`, `saveProgress`, `setComplete`,
`finish` — and treats the LMS as best-effort, so a package still opens and
works if you unzip it and view it locally.

## Trying a package without an LMS

`harness/` is a fake LMS. It runs a built package and shows exactly what the
course reports, which is the fastest way to find out whether something works
before involving a real LMS:

```sh
node tools/unpack.mjs test/output/my-course-scorm12.zip
npm start                      # then open /harness/
```

For SCORM it installs a recording `API` / `API_1484_11` in the page — which is
all an LMS really does — and shows the data model updating live alongside a log
of every call. For xAPI and cmi5 it uses the stub LRS in `server.js`, performs
the cmi5 launch handshake properly (`LMS.LaunchData` written to the State API,
a one-time `fetch` URL for the auth token, launch parameters on the query
string) and lists every statement with its categories and durations, flagging
the cmi5 rules that are easy to break. Switch launch mode to *Browse* or
*Review* to confirm the course correctly goes quiet.

The stub LRS is a test double, not an LRS: no auth enforcement, no querying, no
persistence. It should never face a network.

## Options worth understanding

**Completion.** Default is "every page viewed". You can instead require a
percentage of pages, or mark complete the moment the course opens. Whichever
you pick is enforced by the player, not the LMS.

**Mastery score.** Leave it empty and the course reports *complete*. Set it and
the course also reports pass or fail, scored on the share of pages read — a
page-turner has nothing to grade, so that is the only honest score available.
Set it only if your LMS needs a pass/fail. The UI takes a percentage and
normalises it: SCORM 1.2 gets 0-100 in `cmi.core.score.raw`, everything else
gets a 0-1 scaled value.

**Activity IRI** (xAPI and cmi5). This is how an LRS identifies the course
permanently, so it should be a stable URI on a domain you control. Left empty,
a `urn:` is derived from the identifier; that is a legal IRI and will work, but
it is worth replacing.

**Course language.** Sets the language of the buttons and labels *inside* the
course, and the language tags in the xAPI and cmi5 manifests. Resolved when the
package is built and written into `content/pages.json`, so a package carries
only the language its learners read. Adding a language is one entry per table
in `app/i18n.js`.

**Include SCORM schema files.** Off by default. On, the ADL/IMS `.xsd` files
travel in the package under `SCORM-schemas/` and `xsi:schemaLocation` points at
them. Most LMSs ignore the hint and it adds about 50 kB per package, so turn it
on only for an LMS that validates strictly on import.

**Page text for screen readers.** On by default. Each page's extracted text is
placed in a visually hidden `<figcaption>` next to its image, so the course is
not an unreadable wall of pictures. This is *not* a selectable text layer
positioned over the page — text is not selectable on top of the image, and
scanned PDFs with no text layer yield nothing here.

**Resolution and format.** 150 DPI WebP is a good default. Use JPEG if you must
support a browser without WebP, and PNG only if you need lossless. The long
edge of any page is capped at 2400 px so an oversized page cannot blow up the
canvas allocation.

## Decisions that are easy to get wrong

These are the details that decide whether an LMS accepts the package, recorded
here so nobody has to rediscover them:

- **SCORM 1.2 uses `imsproject.org` for content packaging**, not
  `imsglobal.org`. That only changed in SCORM 2004.
- **`adlcp:scormtype` in 1.2, `adlcp:scormType` in 2004.** The casing changed.
  Get it wrong and the LMS treats the SCO as an inert asset, which silently
  disables all tracking — the package imports fine and simply never reports.
- **`imsss:sequencingType` is an `xs:sequence`**, so the order of its children
  is part of validity: `controlMode`, `sequencingRules`, `limitConditions`,
  `auxiliaryResources`, `rollupRules`, `objectives`, `randomizationControls`,
  `deliveryControls`, `sequencingCollection`. Putting `objectives` after
  `deliveryControls` still parses as XML and is still rejected by the schema.
  Real XSD validation is the only thing that catches this.
- **`xsi:schemaLocation` is only emitted when the schema files ship.** It is a
  hint, and pointing it at `.xsd` files the package does not carry is worse
  than leaving it out, because a validating parser then fails to resolve the
  schema. Without them, LMSs key off the namespace plus `<schema>` and
  `<schemaversion>`, which are exact.
- **`cmi.suspend_data` has a 4096-character limit in SCORM 1.2**, so the
  bookmark is stored as `page~<base64 bitfield>` rather than a JSON array. That
  stays inside the limit past 30,000 pages. SCORM 2004 allows 64,000 and uses
  the same encoding for consistency.
- **Session time is formatted differently per standard**: `HHHH:MM:SS.SS`
  (CMITimespan) for SCORM 1.2, an ISO 8601 duration such as `PT4M12S` for
  SCORM 2004, xAPI and cmi5.
- **`tincan.xml` is a Rustici convention, not a ratified standard.** No IMS or
  ADL document defines it, and its `<name>` carries no `lang` attribute while
  `<description>` and `<launch>` do. It is nonetheless what LMSs mean by "xAPI
  package", so every launch parameter is treated as optional and the course
  degrades to running untracked rather than failing.
- **Per-page xAPI statements are derived from the visited-page list**, not from
  the current page. The player debounces its saves, so reporting only the
  current page silently drops pages turned past quickly — which is precisely
  what per-page tracking exists to capture.
- **cmi5 is strict.** The AU sends `initialized` first and `terminated` last,
  must POST (never GET) the one-time `fetch` URL for its auth token, must use
  the LMS's `contextTemplate` as the base context of every statement without
  overwriting anything in it, and must not touch the `LMS.LaunchData` state
  document — so the resume bookmark lives in a separate state document.
  `launchMode` of `Browse` or `Review` suppresses all result reporting.
  `Launched`, `Waived`, `Satisfied` and `Abandoned` belong to the LMS, not the
  AU, so this player never sends them.
- **cmi5 `moveOn`.** If it requires a pass, the course sends `passed` as well as
  `completed`; otherwise the learner finishes the material and the LMS still
  never marks the course satisfied.
- **The cmi5 XSD requires `<description>`** on both `<course>` and `<au>`, and
  `<au>`'s children are an ordered sequence. Both are enforced when generating
  `cmi5.xml`.

## Tests

```sh
npm test
```

A real end-to-end run, not unit tests around mocks. It:

1. writes a multi-page PDF byte by byte (`test/fixture.mjs`, no dependencies),
2. serves the app and drives it in headless Chromium, building all four
   standards three times over — plain, with schema files, and in Czech — and
   saving every download,
3. loads the two SCORM packages inside a harness page exposing a **recording
   mock of the SCORM API**, pages through the whole course, tears the SCO down
   to trigger `LMSFinish`/`Terminate`, asserts the exact data model values
   written, then relaunches with the mock's stored state to prove resume works,
4. drives the real `harness/` page against the stub LRS for **xAPI and cmi5**,
   checking statement order, durations, the cmi5 and moveon category
   activities, the session id carried through from `contextTemplate`, UUID
   statement ids, one statement per page, and that Browse mode records nothing
   but the bare session,
5. inspects every zip (`test/verify.py`): **validates each manifest against the
   real ADL and cmi5 schemas with `xmllint`**, then checks namespaces, schema
   versions, `scormtype` casing, that every packaged file is declared in
   `<file>` elements, that the declared entry point exists, that the shipped
   adapter is the right one, and that the Czech build really is Czech.

Current state: **219 assertions, all passing** (58 run-time, 161 structural).

Step 5 needs `xmllint`; without it the schema checks are skipped loudly rather
than passing quietly. Everything else needs only Node.

## Known limitations

- **Not verified against a real LMS.** The tests assert conformance to the
  written specifications, to a mock SCORM API and to a stub LRS. They cannot
  prove how a particular Moodle, SuccessFactors or Cornerstone instance
  behaves. Import one package into your own LMS before rolling this out.
- **No real LRS has received a statement.** The xAPI and cmi5 adapters are
  exercised end to end, but against the stub in `server.js`.
- **Scanned PDFs have no text**, so the screen-reader captions come out empty.
  There is no OCR.
- **No quizzes, no branching, no cross-device bookmarking.** This converts a
  document into a trackable page-turner; it is not an authoring tool.
- **`tools/unpack.mjs` does not read Zip64 archives.** It handles what this
  tool produces and says so plainly otherwise.

## Sources

Specifications the implementation was checked against:

- ADL SCORM 1.2 and SCORM 2004 4th Edition, with reference manifests from
  [pipwerks/SCORM-Manifests](https://github.com/pipwerks/SCORM-Manifests) and
  the [ADL SCORM 2004 4th Edition Test Suite](https://github.com/adlnet/SCORM-2004-4ed-Test-Suite).
  The schema files under `schemas/` come from the first of those and are the
  complete import closure, so validation needs no network access.
- [cmi5 specification](https://github.com/AICC/CMI-5_Spec_Current) (AICC),
  including `v1/CourseStructure.xsd` and `v1/examples/simple-cmi5.xml`
- [xAPI](https://github.com/adlnet/xAPI-Spec) 1.0.3, and Rustici's
  [xAPI launch and packaging](https://support.scorm.com/hc/en-us/articles/115000684933-Working-with-launched-xAPI-courses)
  documentation for `tincan.xml`, cross-checked against the reference file in
  [adaptlearning/adapt-contrib-xapi](https://github.com/adaptlearning/adapt-contrib-xapi/blob/master/required/tincan.xml)

## Licence

MIT. Bundled libraries keep their own: pdf.js is Apache-2.0, JSZip is MIT or
GPLv3 — see `vendor/`. The schema files under `schemas/` are ADL and IMS Global
documents, redistributed unmodified.
