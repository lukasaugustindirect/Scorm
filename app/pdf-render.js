// Renders a PDF to raster page images, entirely inside the browser.
//
// Nothing here touches the network: the PDF bytes go from the File object
// straight into pdf.js and the resulting images stay in memory until they are
// zipped up. That is the whole reason this tool is client-side -- a course PDF
// often contains material that must not be uploaded to a third-party service.

import * as pdfjs from '../vendor/pdf.min.mjs';
import { hasTextLayer, headingFromRuns, samplePages } from './derive.js';

// Both of these are overridable so the single-file build can supply its own.
// That build runs from file://, where a page may start a classic Web Worker but
// not a module one and cannot fetch a sibling file at all, so it hands over a
// Blob URL for the worker and has no directory to serve font data from.
// Assignments are short-circuited, never evaluated, when an override is present:
// import.meta.url does not exist in the bundled classic script.

const OVERRIDES = (typeof window !== 'undefined' && window.__PDF_OVERRIDES) || {};

pdfjs.GlobalWorkerOptions.workerSrc = OVERRIDES.workerSrc
  || new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const STANDARD_FONTS = 'standardFontDataUrl' in OVERRIDES
  ? OVERRIDES.standardFontDataUrl
  : new URL('../vendor/standard_fonts/', import.meta.url).href;

// pdf.js reports page geometry in points at 72 dpi, so scale = dpi / 72.
const POINTS_PER_INCH = 72;

/**
 * Opens the document only far enough to read its catalogue, so the UI can show
 * a page count and a suggested title before anyone commits to a full render.
 *
 * @param {ArrayBuffer} bytes raw PDF
 */
/**
 * The text runs of a page, each with the size it was set in.
 *
 * pdf.js gives a transform matrix rather than a font size; the rendered size is
 * the length of its vertical basis vector, which is what hypot of the second
 * column comes to. Font size alone would ignore any scaling on the text.
 */
async function textRuns(page) {
  const content = await page.getTextContent();
  return content.items.map((item) => ({
    str: item.str || '',
    size: Math.hypot(item.transform[2], item.transform[3]),
    // pdf.js's own guess at where a rendered line ends, which is what lets a
    // wrapped title be told from two stacked ones.
    eol: Boolean(item.hasEOL),
  }));
}

/**
 * Everything worth knowing about a PDF before converting it.
 *
 * Deliberately more than the metadata: most documents carry no useful /Title,
 * so the heading is lifted off the first page, and a sample of pages is checked
 * for a text layer. Nobody should have to open a PDF to find out what the tool
 * is going to do with it -- see app/derive.js for the rules that decide.
 */
export async function peek(bytes) {
  const task = pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONTS || undefined,
    isEvalSupported: false,
  });
  const doc = await task.promise;

  try {
    const meta = await doc.getMetadata().catch(() => ({ info: {} }));
    const info = meta.info || {};

    // The largest type on page one, which for a report or a deck is its title.
    let heading = '';
    try {
      heading = headingFromRuns(await textRuns(await doc.getPage(1)));
    } catch {
      // A page that will not give up its text is not a reason to refuse the
      // document: there are two more ways to name the course.
    }

    // Is there a text layer at all, or is this a scan? The sample is kept, not
    // just counted: it is also what the declared language gets checked against.
    const sampled = samplePages(doc.numPages);
    let textChars = 0;
    const sample = [];
    for (const n of sampled) {
      try {
        const runs = await textRuns(await doc.getPage(n));
        for (const run of runs) {
          const text = run.str.trim();
          textChars += text.length;
          if (text) sample.push(text);
        }
      } catch {
        // Counted as no text, which is the safe direction: the worst outcome
        // is offering to attach text that turns out to be empty.
      }
    }

    return {
      numPages: doc.numPages,
      title: (info.Title || '').trim(),
      author: (info.Author || '').trim(),
      subject: (info.Subject || '').trim(),
      // pdf.js surfaces the catalog's /Lang here. Measured on a real document:
      // most carry nothing, but the ones that do are worth believing.
      language: (info.Language || '').trim(),
      heading,
      textChars,
      sampledPages: sampled.length,
      hasText: hasTextLayer(textChars, sampled.length),
      // Enough to tell the languages this tool ships apart, and no more: the
      // whole document would be pointless to carry around for one check.
      sampleText: sample.join(' ').slice(0, 4000),
    };
  } finally {
    // destroy() is on the loading task; PDFDocumentProxy only offers cleanup().
    await task.destroy();
  }
}

/**
 * @param {ArrayBuffer} bytes            raw PDF
 * @param {object}      options
 * @param {number}      options.dpi      target render resolution
 * @param {string}      options.format   'image/webp' | 'image/png' | 'image/jpeg'
 * @param {number}      options.quality  0..1, ignored for png
 * @param {number}      options.maxWidth clamp on the long edge, in pixels
 * @param {boolean}     options.extractText  collect per-page text for screen readers
 * @param {(done:number,total:number)=>void} onProgress
 */
export async function renderPdf(bytes, options, onProgress = () => {}) {
  const {
    dpi = 150,
    format = 'image/webp',
    quality = 0.85,
    maxWidth = 2400,
    extractText = true,
  } = options || {};

  const task = pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONTS || undefined,
    // Rendering is the only thing we need; skip the interactive-form machinery
    // so a PDF with AcroForm widgets cannot execute its embedded JavaScript.
    isEvalSupported: false,
  });
  const doc = await task.promise;

  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const pages = [];

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      pages.push(await renderPage(page, { dpi, format, quality, maxWidth, extractText }, n));
      page.cleanup();
      onProgress(n, doc.numPages);
    }
  } finally {
    await task.destroy();
  }

  return {
    pages,
    title: (meta.info && meta.info.Title && meta.info.Title.trim()) || '',
    author: (meta.info && meta.info.Author && meta.info.Author.trim()) || '',
  };
}

// The page list is 9rem wide; 240 px covers a 2x display. Quality is lower than
// the page's own because at this size nobody can tell and the bytes add up.
const THUMB_WIDTH = 240;
const THUMB_QUALITY = 0.7;

async function renderPage(page, { dpi, format, quality, maxWidth, extractText }, pageNumber) {
  let scale = dpi / POINTS_PER_INCH;

  // Clamp the long edge so a poster-sized page cannot produce a 20k-pixel
  // canvas that the browser refuses to allocate.
  const unscaled = page.getViewport({ scale: 1 });
  const longEdge = Math.max(unscaled.width, unscaled.height);
  if (longEdge * scale > maxWidth) scale = maxWidth / longEdge;

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const context = canvas.getContext('2d', { alpha: false });
  // A PDF page is paper: unpainted areas are white, not transparent.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport, intent: 'print' }).promise;

  const blob = await toBlob(canvas, format, quality);
  // Downscaled from the canvas already in hand rather than rendered again: the
  // PDF page has been rasterised once, and drawing it small is nearly free.
  const thumb = await toThumb(canvas, format);
  let text = '';
  if (extractText) text = await pageText(page);

  // Release the backing store; Safari in particular holds on to large canvases.
  canvas.width = canvas.height = 0;

  return {
    pageNumber, blob, thumb,
    width: viewport.width, height: viewport.height, text,
  };
}

/**
 * A small image for the page list.
 *
 * Measured on a real 38-page deck: without this, opening the list pulled 4.5 MB
 * and decoded 38 full-resolution bitmaps to draw them 107 px wide. The rail is
 * 9rem, so 240 px covers a 2x display with room to spare, and the whole set
 * costs a fraction of one full page.
 *
 * Encoded at a lower quality than the page itself -- at this size the
 * difference is invisible and the saving is not. PNG is never used for these,
 * whatever the page format: a screenshot-sized PNG defeats the point.
 */
async function toThumb(canvas, format) {
  const width = Math.min(THUMB_WIDTH, canvas.width);
  const height = Math.max(1, Math.round((canvas.height / canvas.width) * width));

  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const context = small.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  // Browsers default to a decent filter, but say so: a nearest-neighbour
  // downscale of dense slide text is unreadable mush.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, width, height);

  const type = format === 'image/png' ? 'image/webp' : format;
  const blob = await toBlob(small, type, THUMB_QUALITY);
  small.width = small.height = 0;
  return blob;
}

function toBlob(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        // A browser that does not know the requested type hands back null.
        else if (format !== 'image/png') toBlob(canvas, 'image/png', 1).then(resolve, reject);
        else reject(new Error('Could not encode page image'));
      },
      format,
      format === 'image/png' ? undefined : quality,
    );
  });
}

async function pageText(page) {
  try {
    const content = await page.getTextContent();
    // Items carry no paragraph structure, but hasEOL marks pdf.js's own guess
    // at line breaks, which is enough to keep a screen reader intelligible.
    return content.items
      .map((item) => (item.str || '') + (item.hasEOL ? '\n' : ''))
      .join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return '';
  }
}

export function extensionFor(format) {
  if (format === 'image/png') return 'png';
  if (format === 'image/jpeg') return 'jpg';
  return 'webp';
}
