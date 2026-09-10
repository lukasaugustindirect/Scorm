// Working out what a PDF is, so nobody has to look inside it.
//
// A person converting a document should not have to know whether their PDF
// happens to carry a /Title, what their design tool wrote into it, or whether
// there is a text layer. These are the rules that decide, and they live here --
// away from the DOM and away from pdf.js -- so they can be tested directly
// against the awkward cases rather than only through a browser.
//
// The bias throughout is: never make a correct value worse. A title that was
// already right must survive untouched, and every guess has to be visible in
// the interface so it can be overridden.

/**
 * Producer prefixes. Word and PowerPoint write "Microsoft Word - report.docx"
 * into /Title, which is the source file name wearing a hat.
 */
const PRODUCER_PREFIX = /^(microsoft\s+)?(word|powerpoint|excel|publisher|visio)\s*[-–—:]\s*/i;

/** Extensions that mean /Title is a file name rather than a title. */
const DOC_EXTENSION =
  /\.(pdf|docx?|pptx?|xlsx?|pages|key|numbers|odt|odp|ods|indd|ai|rtf|txt|tex)$/i;

/**
 * Default document names, in the languages the tools that write them ship in.
 * Trailing digits included, since "Presentation1" and "Document 2" are the
 * common shapes.
 */
const PLACEHOLDER_TITLE = new RegExp(
  '^(' + [
    'untitled', 'unbenannt', 'sans[- ]titre', 'senza[- ]titolo', 'sin[- ]t[íi]tulo',
    'bez[- ]n[áa]zvu', 'document', 'dokument', 'documento', 'presentation',
    'pr[ée]sentation', 'pr[äa]sentation', 'prezentace', 'presentazione',
    'slides?', 'slide[- ]show', 'book', 'kniha', 'workbook', 'sheet', 'list',
    'new (document|presentation|microsoft (word|powerpoint) document)',
    'nov[ýá] (dokument|prezentace)', 'output', 'print', 'scan', 'tisk', 'export',
    'final', 'draft', 'kopie', 'copy',
  ].join('|') + ')[\\s._-]*\\d*$',
  'i',
);

/** Only digits and separators: a date, a version, an invoice number. */
const NO_WORDS = /^[\d\s._\-/:()[\]]+$/;

/**
 * A version string, which export presets like to leave behind. Whitespace
 * counts as a separator because the file-name tidying runs first and turns
 * "v2.1" into "v2 1" before this ever sees it.
 */
const VERSION_ONLY = /^v(er(sion)?)?[\s.]*\d+([._\s-]\d+)*\s*[a-z]?$/i;

/** A hex digest or a UUID, which some pipelines use as the document name. */
const DIGEST = /^[0-9a-f]{16,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A title has to be long enough to name something and short enough to use. */
const MIN_TITLE = 3;
const MAX_TITLE = 160;

/** Turns filename separators into spaces. Nothing is dropped or reordered. */
function tidySeparators(text) {
  return String(text)
    .replace(/[_]+/g, ' ')
    .replace(/\.+/g, ' ')
    .replace(/\s+/g, ' ')
    // A space before punctuation is an artefact of the joining, never intended.
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/**
 * A course title guessed from a file name.
 *
 * Only separators are touched. A file name is the author's own words, and a
 * cleverer guess -- dropping leading dates, say -- would mangle names that were
 * already right. Falls back to the name itself so this never returns nothing.
 */
export function titleFromFilename(name) {
  const stem = String(name).replace(DOC_EXTENSION, '');
  return tidySeparators(stem) || String(name);
}

/**
 * Reads a /Title, and says whether it was really a file name.
 *
 * That second part matters more than it looks. "Microsoft Word -
 * export_final_v2.docx" cleans up to "export final v2", which passes every test
 * for a plausible title and tells a learner nothing. But the prefix and the
 * extension are themselves the evidence: a /Title shaped like that IS a file
 * name, so it should rank below the heading on the page rather than beat it.
 *
 * @returns {{ text: string, looksLikeFilename: boolean }} text is '' when
 *   nothing usable is left, which is the signal to look at the page instead
 */
export function readMetaTitle(raw) {
  let text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!text) return { text: '', looksLikeFilename: false };

  // "Microsoft Word - report.docx" -> "report.docx"
  const stripped = text.replace(PRODUCER_PREFIX, '').trim();
  let looksLikeFilename = stripped !== text;
  if (stripped) text = stripped;

  // "report.docx" -> "report"
  const withoutExtension = text.replace(DOC_EXTENSION, '').trim();
  if (withoutExtension !== text) looksLikeFilename = true;
  if (withoutExtension) text = withoutExtension;

  // Underscores where spaces belong is the other giveaway.
  if (/_/.test(text)) looksLikeFilename = true;

  // Only tidy separators when the title looks like a file name -- a real title
  // may legitimately contain a full stop, and "Ltd. v. Smith" must survive.
  if (/[_]/.test(text) || !/\s/.test(text)) text = tidySeparators(text);
  else text = text.replace(/\s+/g, ' ').trim();

  return { text, looksLikeFilename };
}

/** The cleaned text of a /Title, without the provenance. */
export function cleanMetaTitle(raw) {
  return readMetaTitle(raw).text;
}

/**
 * Whether a cleaned /Title is worth using.
 *
 * "Junk" here means: tells the learner nothing the file name would not. Being
 * wrong in this direction is cheap, because the fallbacks are the page heading
 * and the file name; being wrong the other way ships a course called
 * "Presentation1".
 */
export function isUsableTitle(title, _filename) {
  const text = String(title || '').trim();
  if (text.length < MIN_TITLE || text.length > MAX_TITLE) return false;
  if (!/\p{L}/u.test(text)) return false;
  if (NO_WORDS.test(text)) return false;
  if (VERSION_ONLY.test(text)) return false;
  if (DIGEST.test(text) || UUID.test(text)) return false;
  if (PLACEHOLDER_TITLE.test(text)) return false;
  // A /Title that matches the file name is NOT junk. An earlier version treated
  // it as adding nothing and fell through to the page heading, which replaced
  // "Skoleni BOZP 2026" with whatever was set biggest on page one. Two sources
  // agreeing is corroboration; the file name was almost certainly typed from
  // the title by a person.
  return true;
}

/**
 * Whether text lifted off the first page can serve as the title.
 *
 * Looser than isUsableTitle: this text was set in the largest type on the page,
 * so it is very likely the heading. It still has to be a heading and not a
 * slide number or a date stamp.
 */
export function isUsableHeading(text) {
  const heading = String(text || '').trim();
  if (heading.length < MIN_TITLE || heading.length > MAX_TITLE) return false;
  if (!/\p{L}/u.test(heading)) return false;
  if (NO_WORDS.test(heading)) return false;
  if (PLACEHOLDER_TITLE.test(heading)) return false;
  // Running heads and page furniture.
  if (/^(page|strana|str\.?|slide|snímek)\s*\d+/i.test(heading)) return false;
  return true;
}

/**
 * The course title, and where it came from.
 *
 * The source matters as much as the value: the interface says which one was
 * used, because a guess the person cannot see is worse than no guess.
 *
 * @returns {{ title: string, source: 'metadata'|'page'|'filename' }}
 */
export function courseTitle({ metaTitle, heading, filename }) {
  const meta = readMetaTitle(metaTitle);
  const metaUsable = isUsableTitle(meta.text, filename);

  // A real title, deliberately set, outranks everything.
  if (metaUsable && !meta.looksLikeFilename) {
    return { title: meta.text, source: 'metadata' };
  }

  // Then the heading off the page, which is what a person would call the thing.
  const fromPage = String(heading || '').replace(/\s+/g, ' ').trim();
  if (isUsableHeading(fromPage)) {
    return { title: fromPage, source: 'page' };
  }

  // A /Title that turned out to be a file name still beats the file in hand:
  // it names the document this PDF was made from, which is often the better of
  // the two. Reported as a file name, because that is what it is.
  if (metaUsable) {
    return { title: meta.text, source: 'filename' };
  }

  return { title: titleFromFilename(filename), source: 'filename' };
}

/**
 * Characters that only Czech (of the languages this tool ships) uses.
 *
 * A carrier signal, not a spell checker: English has none of these at all, so a
 * document carrying them in any quantity is not English whatever it claims.
 */
const CZECH_LETTERS = /[ěščřžůďťňáéíóúý]/gi;

/** Below this many per thousand letters, there is no signal worth acting on. */
const CZECH_PER_THOUSAND = 15;

/**
 * Which of the languages we ship a sample of text looks like.
 *
 * Deliberately only able to answer "Czech", "not Czech" or "no idea". Telling
 * English from German would need real language detection; telling Czech from
 * English needs one character class, and that is the case in front of us.
 *
 * @returns {'cs'|'en'|null} null when the sample is too short to say
 */
export function looksLikeLanguage(text) {
  const sample = String(text || '');
  const letters = (sample.match(/\p{L}/gu) || []).length;
  if (letters < 200) return null;
  const czech = (sample.match(CZECH_LETTERS) || []).length;
  return (czech * 1000) / letters >= CZECH_PER_THOUSAND ? 'cs' : 'en';
}

/**
 * The course language, from what the document declares -- if the document's own
 * text does not contradict it.
 *
 * A deck written in English should give its learners English buttons even when
 * the person converting it is working in a Czech interface, which is what
 * following the interface language blindly got wrong. Region is dropped:
 * "en-GB" and "en-US" are both English as far as the player's labels go.
 *
 * The corroboration is not caution for its own sake. Both real Czech decks this
 * was tested against declare /Lang "en" -- PowerPoint writes the authoring
 * machine's locale, not the document's language -- so believing the declaration
 * alone shipped Czech training with English buttons. When the text disagrees
 * with the tag, neither is trusted and the default stands: refusing to guess is
 * not the same as guessing the opposite.
 *
 * @param {string} declared the document's own tag
 * @param {string[]} available languages the tool ships
 * @param {string} [sample] text from the document, to check the tag against
 * @returns {string|null} a language the tool ships, or null to keep the default
 */
export function courseLanguage(declared, available, sample) {
  const tag = String(declared || '').trim().toLowerCase();
  if (!tag) return null;
  const primary = tag.split(/[-_]/)[0];
  if (!primary || !available.includes(primary)) return null;

  const looks = looksLikeLanguage(sample);
  if (looks && looks !== primary) return null;
  return primary;
}

/**
 * The heading of a page, from its text runs.
 *
 * Takes the largest type on the page, which for a title page or a slide is the
 * title. Sizes are rounded before grouping because a single line can vary by a
 * fraction of a point.
 *
 * @param {Array<{str: string, size: number, eol?: boolean}>} runs text runs
 *   with their sizes; eol marks the end of a rendered line
 */
export function headingFromRuns(runs) {
  const groups = new Map();
  for (const run of runs || []) {
    const text = String(run && run.str || '');
    const eol = Boolean(run && run.eol);
    // pdf.js reports the end of a line as its own empty item rather than a flag
    // on the last piece of text, so discarding empty items throws the line
    // structure away -- which is how a two-line cover came out as a run-on.
    if (!text.trim() && !eol) continue;
    const size = Math.round(Number(run.size) * 2) / 2;
    if (!Number.isFinite(size) || size <= 0) continue;
    if (!groups.has(size)) groups.set(size, []);
    groups.get(size).push({ text: text.trim() ? text : '', eol });
  }

  // Largest first, so a heading wins over body text; walk down if the biggest
  // type turns out to be page furniture or a decorative glyph.
  for (const size of [...groups.keys()].sort((a, b) => b - a)) {
    const candidate = joinHeading(groups.get(size));
    if (isUsableHeading(candidate)) return candidate;
  }
  return '';
}

/**
 * Assembles a heading out of the runs set in one size.
 *
 * Two joins, and both were found the hard way on real documents.
 *
 * Within a line: pdf.js splits a run wherever the PDF adjusts kerning, so a
 * heading arrives either as words or as individual glyphs. Spaces are right for
 * the first and ruinous for the second.
 *
 * Between lines: a title block may be one phrase that wrapped, or two separate
 * phrases stacked. One deck's cover reads "Pojištění" / "podnikání" -- one
 * phrase, and it has to come out "Pojištění podnikání". Another's reads
 * "Produktový den" / "Odpovědnost - výrobek, služba" -- two, and joining those
 * with a space produces a run-on. A line beginning in lower case continues the
 * one before it; a line beginning in upper case starts something new. Not
 * infallible, but it is right on both, and the title is announced and editable.
 */
function joinHeading(items) {
  const lines = [];
  let current = [];
  for (const item of items) {
    if (item.text) current.push(item.text);
    if (item.eol) { lines.push(current); current = []; }
  }
  if (current.length) lines.push(current);

  const rendered = lines.map((parts) => {
    const singles = parts.filter((part) => part.trim().length === 1).length;
    return (singles > parts.length / 2 ? parts.join('') : parts.join(' '))
      .replace(/\s+/g, ' ')
      .trim();
  }).filter(Boolean);

  let heading = rendered[0] || '';
  for (const line of rendered.slice(1)) {
    const continues = /^\p{Ll}/u.test(line);
    heading += (continues ? ' ' : ' – ') + line;
  }
  return heading.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/**
 * Whether a document carries a text layer worth extracting.
 *
 * A scanned PDF is images of pages: the "page text for screen readers" option
 * has nothing to find, and left alone it ships a course that claims to be
 * accessible and is not. The threshold is deliberately low -- a handful of
 * characters across the sample is what a stray watermark or a page number
 * produces, and that is not a text layer.
 *
 * @param {number} chars characters found across the sampled pages
 * @param {number} sampled how many pages were sampled
 */
export function hasTextLayer(chars, sampled) {
  if (!sampled) return false;
  return chars >= Math.max(40, sampled * 20);
}

/**
 * Which pages to sample when deciding whether there is a text layer.
 *
 * Spread across the document rather than the first few: a scan often has a
 * generated cover page with real text, and the first pages of a report can be
 * a title and a blank.
 */
export function samplePages(total, limit = 5) {
  const count = Math.min(total, limit);
  if (count <= 0) return [];
  if (total <= limit) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set();
  for (let i = 0; i < count; i++) {
    pages.add(1 + Math.round((i * (total - 1)) / (count - 1)));
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Which message a failure from pdf.js deserves.
 *
 * pdf.js names its own exception types, and two of them are things a person can
 * actually do something about. Everything else keeps its own message, which is
 * at least a clue for whoever gets asked.
 *
 * A pure mapping rather than a branch in the interface, because building an
 * encrypted PDF by hand to test the locked path is a great deal of work for a
 * two-line rule -- this way the rule is checked directly, and the note stands
 * that no real encrypted document is exercised.
 *
 * @returns {'source.locked'|'source.corrupt'|null} null: use the generic message
 */
export function failureKey(err) {
  const name = err && err.name;
  if (name === 'PasswordException') return 'source.locked';
  if (name === 'InvalidPDFException') return 'source.corrupt';
  // pdf.js has not always been consistent about the class name reaching the
  // caller, so the message is a second chance at the same two cases.
  const message = String((err && err.message) || '');
  if (/password/i.test(message)) return 'source.locked';
  if (/invalid pdf|no pdf header|structure/i.test(message)) return 'source.corrupt';
  return null;
}
