// Builds a small multi-page PDF by hand.
//
// Written out byte by byte rather than pulled from a library so the test suite
// needs nothing but Node: a fixture generator that itself needs installing is
// a fixture generator that rots.

const ENCODING = 'latin1';

function escapeText(value) {
  // Literal strings in a PDF are parenthesised, so those and the escape
  // character itself have to be escaped.
  //
  // Anything outside WinAnsi goes too, and not silently: this file serialises
  // as latin1, so a Czech 'c with caron' (U+010D) would be written as its low
  // byte 0x0D -- a carriage return in the middle of a content stream. That is
  // how "Bezpečnost" came out of a fixture as "Bezpe nost", and a different
  // character could corrupt the stream outright. The base-14 Helvetica this
  // fixture draws with has no such glyph anyway; real PDFs embed a font.
  return String(value)
    .replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, '?')
    .replace(/([\\()])/g, '\\$1');
}

/**
 * A text string for a PDF dictionary.
 *
 * A parenthesised literal can only carry PDFDocEncoding, and this file
 * serialises as latin1 -- so a Czech 'c with caron' (U+010D) would be written
 * as its low byte 0x0D, a carriage return inside the string, and the character
 * would simply vanish. Real producers write anything beyond ASCII as a UTF-16BE
 * hex string led by a byte-order mark, which is what pdf.js reads back, so that
 * is what this does.
 */
function pdfString(value) {
  const text = String(value);
  if (!/[^\x20-\x7e]/.test(text)) return `(${escapeText(text)})`;

  // Node writes UTF-16 little-endian, so the bytes of each unit are swapped
  // into big-endian order on the way out.
  const le = Buffer.from(text, 'utf16le');
  let hex = 'feff';
  for (let i = 0; i < le.length; i += 2) {
    hex += le[i + 1].toString(16).padStart(2, '0') + le[i].toString(16).padStart(2, '0');
  }
  return `<${hex}>`;
}

/**
 * @param {object} options
 * @param {number} options.pages  how many pages to emit
 * @param {string} options.title  written into the document Info dictionary
 * @returns {Buffer}
 */
/**
 * @param {object} [options]
 * @param {number} [options.pages]     how many pages to emit
 * @param {string|null} [options.title] /Title; null or '' omits it entirely,
 *                                      which is what most real PDFs do
 * @param {string} [options.language]  written as the catalog's /Lang
 * @param {boolean} [options.text]     false emits pages with no text operators
 *                                     at all, which is what a scan looks like
 * @param {string} [options.heading]   large text at the top of page one, for
 *                                     the title-from-the-page path
 * @returns {Buffer}
 */
export function makePdf({
  pages = 3,
  title = 'Fixture Document',
  language = '',
  text = true,
  heading = '',
} = {}) {
  // Object numbering: 1 catalog, 2 page tree, 3 font, then a page object and a
  // content stream per page, and finally the Info dictionary.
  const objects = [];
  const pageObjNum = (i) => 4 + i * 2;
  const contentObjNum = (i) => 5 + i * 2;
  const infoObjNum = 4 + pages * 2;

  const kids = [];
  for (let i = 0; i < pages; i++) kids.push(`${pageObjNum(i)} 0 R`);

  // /Lang lives on the catalog, which is where pdf.js reads it from and
  // reports as info.Language.
  const lang = language ? ` /Lang ${pdfString(language)}` : '';
  objects[1] = `<< /Type /Catalog /Pages 2 0 R${lang} >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ` +
               `/Encoding /WinAnsiEncoding >>`;

  for (let i = 0; i < pages; i++) {
    const n = i + 1;
    // A page with no text operators is what a scanned document looks like to
    // pdf.js: something is drawn, so it still renders, but getTextContent()
    // finds nothing to return.
    const stream = !text
      ? `0.85 0.85 0.85 rg 72 300 450 450 re f\n` +
        `0.6 0.6 0.6 rg 110 640 280 40 re f`
      // The marker text is what the extracted-text assertion looks for.
      : (heading && n === 1
          ? `BT /F1 48 Tf 72 760 Td (${escapeText(heading)}) Tj ET\n`
          : '') +
        `BT /F1 28 Tf 72 720 Td (Fixture page ${n}) Tj ET\n` +
        `BT /F1 12 Tf 72 680 Td (${escapeText('Page ' + n + ' of ' + pages + '.')}) Tj ET\n` +
        `BT /F1 12 Tf 72 660 Td (${escapeText('SCORM converter test fixture.')}) Tj ET`;

    objects[pageObjNum(i)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum(i)} 0 R >>`;

    objects[contentObjNum(i)] =
      `<< /Length ${Buffer.byteLength(stream, ENCODING)} >>\n` +
      `stream\n${stream}\nendstream`;
  }

  // Most real PDFs carry no /Title at all, so omitting it has to be possible.
  objects[infoObjNum] = title
    ? `<< /Title ${pdfString(title)} /Author (Test Fixture) >>`
    : `<< /Author (Test Fixture) >>`;

  // --- serialise, recording where each object starts ---
  const chunks = [];
  let offset = 0;
  const offsets = [];

  const push = (text) => {
    const buffer = Buffer.from(text, ENCODING);
    chunks.push(buffer);
    offset += buffer.length;
  };

  push('%PDF-1.4\n');
  // A binary comment marks the file as non-ASCII so tools do not mangle it.
  push('%\xE2\xE3\xCF\xD3\n');

  for (let num = 1; num <= infoObjNum; num++) {
    offsets[num] = offset;
    push(`${num} 0 obj\n${objects[num]}\nendobj\n`);
  }

  const xrefStart = offset;
  const total = infoObjNum + 1;

  // The cross-reference table: one fixed-width 20-byte entry per object,
  // starting with the mandatory free-object head of the linked list.
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let num = 1; num <= infoObjNum; num++) {
    xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoObjNum} 0 R >>\n`);
  push(`startxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
