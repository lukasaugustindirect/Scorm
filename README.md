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

## Just want to use it

Download **[`dist/pdf-to-scorm.html`](dist/pdf-to-scorm.html)** and open it by
double-click. That one file is the whole converter: no server, no Node, no
install, no internet. It can be emailed as a single attachment, which is the
easiest way to hand it to a colleague.

Rebuild it after changing anything under `app/` or `player/`:

```sh
npm run build:single
```

Getting one file to work from `file://` takes some doing, since such a page
cannot load ES modules, cannot start a *module* Worker and cannot fetch a
sibling file. So the app is bundled into one classic script, pdf.js 3.11.174
(the last release with a non-module worker) is started from a Blob URL, and the
player, adapters and schemas ride along as embedded strings. Downloads *do*
work from `file://`, which is what makes the whole approach viable — the test
suite asserts every one of those points rather than trusting them.

The served version below uses the modern pdf.js and is what you want on an
internal web server, where it is just a URL for everyone.

## Running it as a site

pdf.js parses in a Web Worker, and browsers refuse to start a *module* worker
from a `file://` origin, so the served page has to come over HTTP. Any static
host will do; `npm start` exists so you need not install anything:

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

## Importing into Sana

Sana takes SCORM 1.2 and SCORM 2004, as a `.zip` — not an unzipped folder:
**Manage → Content → Import → SCORM**. SCORM 1.2 is what this tool builds by
default, so a package is ready to import as it comes out.

Three things about Sana that shape how a package behaves, and how this tool
handles each:

**Whitelisting is not needed.** Sana requires the domain of any embedded
content to be allowed through its CSP, and content loaded in an iframe that
way is a documented cause of courses that never report back. These packages
load nothing from the network: every image, script, style and page is inside
the zip. `test/verify.py` asserts it on every build — the only URLs a package
contains are XML namespaces and xAPI vocabulary IRIs, which are names rather
than addresses, and the course's own IRI. A CDN font or an analytics snippet
would break the property silently, in someone else's LMS, months later, so it
is pinned rather than trusted.

**Completion is decided by the package, not by Sana.** With no pass mark set,
the course reports `completed` once the completion rule is met, and Sana closes
it. Set a pass mark and it reports `passed` or `failed` instead, and Sana keeps
the course open until the learner passes. Both are one field under Settings;
neither is invented here.

**Re-converting an updated PDF: keep the identifier.** For small fixes Sana
offers *Update SCORM package*; for larger changes the item identifier in
`imsmanifest.xml` has to change or learners never see the new version — and
changing it wipes their saved progress. This tool derives the identifier from
the course title, so re-converting a corrected PDF under the same title
produces the same identifier, which is what you want. Rename the course and you
have started a new one. The Settings field says so, and can be pinned by hand.

Worth knowing before choosing this route at all: **Sana can convert a PDF into
a native interactive course itself**, with AI-generated quizzes. That is faster
and better integrated, and it is the right answer when you want quizzes that
are not in the document. It is the wrong answer when the course must be a
faithful rendering of an approved document, when the PDF must not be uploaded
anywhere, or when the same course has to run in other systems — which is what
this tool is for.

## What a package weighs

Measured on three real 36-41 page Czech training decks, 16:9 slides:

| | |
| --- | --- |
| Build, all pages | 7-9 seconds |
| Package | 2.9-4.8 MB |
| Per page | 64-124 kB at the default 150 DPI |
| Opening the page list | 156 kB |

That last number was 4.5 MB until the page list got its own images. Every
thumbnail was the full-resolution page, downloaded and decoded to be drawn
107 px wide — all of them at once, since `loading="lazy"` does not defer
images inside an open scroll container. Each page now also ships a 240 px copy,
about 4 kB, which costs 3% on the package and cuts the list 29-fold. The
ratio is asserted on every build, not just the files' presence: a "thumbnail"
encoded at full resolution would pass a file-exists check and fix nothing.

150 DPI on a 16:9 slide comes to 2000x1125, which is enough for dense body
text — checked by eye on slides carrying 20pt bullet lists and 14pt legal
citations. Raising it is a setting; on these documents it is not needed.

A 38-page course was also driven through a recording SCORM 1.2 API end to end:
`completed` on the last page, the bookmark at page 38, 22 API calls for 38
pages, `suspend_data` 11 characters against the standard's 4096 limit, and a
relaunch that resumed on page 38 with every page still marked read.

## Trying a package without an LMS

**To see the course**, unzip a package and open `index.html` by double-click.
That works, and it is worth knowing why it takes any doing: the player needs its
course manifest, and a page opened from `file://` cannot fetch its own siblings,
so a fetch of `content/pages.json` fails with *"Failed to fetch"* and nothing
loads at all. The manifest therefore also rides inline in `index.html`, written
in at build time, and the fetch is only a fallback. Page images are `<img src>`
and were never affected — the two load differently on `file://`, which is the
trap. `test/offline.mjs` asserts all of it, because this was broken once and
every other stage serves the package over HTTP, where it cannot fail.

Opened that way the course says it is not connected and saves no progress,
which is correct: there is no LMS to save to.

**To see what the course reports**, `harness/` is a fake LMS. It runs a built
package and shows exactly what goes back, which is the fastest way to find out
whether something works before involving a real LMS:

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

## How it looks, and why

Warm parchment rather than the cold white of most developer tools: the ground is
`#f7f4ed`, and the palette is built warm from there. The composition is one idea
— the drop zone *is* the card, floating on the parchment as the single object on
the page, rather than sitting inside another box. Nesting cards is what made
earlier versions read as a form instead of an application.

Amber is flat, never a gradient, and the palette splits it in two, which is the
part that is easy to get wrong: white text on bright amber measures **2.15:1**
and is unreadable, so bright amber is only ever a *fill* and carries near-black
text at **8.8:1**. Where amber has to *be* text or an icon on white it drops to
amber-700, which reaches **5.0:1**. Both figures were computed, not eyeballed —
if you change the accent, recompute them.

The typeface is Inter, embedded as base64 in `app/fonts.css` rather than linked,
because the single-file build runs from `file://` where a page cannot fetch its
own siblings. The shipped player deliberately does *not* carry it: 175 kB in
every package a learner downloads is not worth it for a page-turner whose text
lives inside the page images.

## Several PDFs at once

Drop a folder's worth. Each PDF becomes its own course, with its own title and
language worked out from its own document, shown in a row you can edit in
place; the per-course fields under Settings stand down, with a note saying
where those now live. Two PDFs that work out to the same title get distinct
identifiers (`Onboarding`, `Onboarding-2`), so neither package overwrites the
other, and their rows carry the file name so they can be told apart.

Downloads come **one bundle per format** — `scorm12-5-courses.zip` holding
five packages — because an LMS imports one zip per course and format, and a bulk
upload wants all the SCORM 1.2 ones together rather than a mix.

Files are read one after another, not all at once: pdf.js holds each document in
memory while it is open, and twenty opened together is how a browser tab dies.

## What it works out for itself

Nobody should have to look inside a PDF to find out what the tool will do with
it, so these are decided on the document rather than left as settings. Each one
is stated on the first screen — a decision nobody can see is worse than no
decision — and each can be overridden under Settings.

**The course name.** Most PDFs carry no `/Title` at all, and many carry
something worse: `Presentation1`, `Untitled`, `output`, a hash, or
`Microsoft Word - export_final_v2.docx`, which is a file name wearing a hat.
So a `/Title` is used only if it survives a credibility check, and otherwise the
name comes from **the largest type on page one**, which for a report or a deck
is its heading. Only then does the file name get a turn, with its underscores
tidied into spaces. A `/Title` that turns out to be a file name ranks *below*
the page heading but still above the file in hand.

Nothing here rewrites a title that was already right, and nothing reorders or
drops words: a cleverer guess would mangle correct names, which is a worse
failure than a dull one. `test/derive.mjs` covers the rules directly, including
every junk value listed above.

**The course language.** Read from the document's own `/Lang` when it declares
one, so an English deck gives its learners English buttons even when the person
converting it is working in a Czech interface. Following the interface language
blindly is what got that wrong.

**Scanned PDFs.** A scan is pictures of pages with no text layer, so there is
nothing for the screen-reader option to attach. Pages are sampled across the
document — not just the front, since a scan often has a generated cover page
with real text — and if there is no text the option is switched off and said
so, rather than silently shipping a course that claims to be accessible.

**Locked and damaged files.** A password-protected or truncated PDF gets a
sentence about what to do, in the interface language, instead of whatever
pdf.js threw.

## Options worth understanding

You do not have to read any of this to use the tool. Drop a PDF, press the
button, and a **SCORM 1.2** package is built with defaults that work — that is
the one format every LMS accepts, and one zip is what a person expects to get.
SCORM 2004, xAPI and cmi5 are one tick away under the folded
**Nastavení / Settings** panel, along with the options below for the cases
where the defaults are not what you want.

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

0. checks the rules that decide what a PDF is (`test/derive.mjs`) in plain Node,
   before Chromium starts — every junk `/Title`, a heading split into single
   glyphs, a language tag with a region, a scan with a text cover page,
1. writes a multi-page PDF byte by byte (`test/fixture.mjs`, no dependencies),
   including the awkward shapes: no `/Title`, a `/Lang`, no text layer at all,
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
5. builds the **single-file variant** and drives it as a real `file://`
   document, proving the Blob worker starts, all four standards build, and a
   download still reaches the user with no server at all,
6. inspects every zip (`test/verify.py`): **validates each manifest against the
   real ADL and cmi5 schemas with `xmllint`**, then checks namespaces, schema
   versions, `scormtype` casing, that every packaged file is declared in
   `<file>` elements, that the declared entry point exists, that the shipped
   adapter is the right one, that the Czech build really is Czech, that a course
   title with diacritics survives the whole path from the PDF's Info dictionary
   into the manifest XML, and that the single-file variant's packages are
   identical in every respect,
7. unzips each built package and opens it as a real `file://` document
   (`test/offline.mjs`) — the double-click path, which was broken once while
   every served stage stayed green,
8. drives the converter against PDFs that are **not** the happy case
   (`test/awkward.mjs`): no title, a title Word invented, a scan, an English
   document in a Czech interface, a truncated file — asserting the name, the
   language, the switched-off option and the sentence the interface shows,
9. drops three PDFs at once (`test/bulk.mjs`), two of them sharing a title,
   edits one title in place, builds, and opens the SCORM 1.2 bundle to check it
   holds exactly one correctly named package per course with the edited title
   and each document's own language.

Current state: **550 assertions, all passing** (85 rule checks in plain
Node, 141 run-time in the browser, 324 structural).

Step 6 needs `xmllint`; without it the schema checks are skipped loudly rather
than passing quietly. Everything else needs only Node and, for the build, the
one devDependency `esbuild`.

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
GPLv3 — see `vendor/`. The typeface is Inter, SIL Open Font License, embedded
by `app/fonts.css` (regenerate with `node tools/build-fonts.mjs`) — see
`vendor/fonts/inter-LICENSE.txt`. The schema files under `schemas/` are ADL and
IMS Global documents, redistributed unmodified.
