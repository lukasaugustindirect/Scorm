// Renders a PDF to raster page images, entirely inside the browser.
//
// Nothing here touches the network: the PDF bytes go from the File object
// straight into pdf.js and the resulting images stay in memory until they are
// zipped up. That is the whole reason this tool is client-side -- a course PDF
// often contains material that must not be uploaded to a third-party service.

import * as pdfjs from '../vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const STANDARD_FONTS = new URL('../vendor/standard_fonts/', import.meta.url).href;

// pdf.js reports page geometry in points at 72 dpi, so scale = dpi / 72.
const POINTS_PER_INCH = 72;

/**
 * Opens the document only far enough to read its catalogue, so the UI can show
 * a page count and a suggested title before anyone commits to a full render.
 *
 * @param {ArrayBuffer} bytes raw PDF
 */
export async function peek(bytes) {
  const task = pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONTS,
    isEvalSupported: false,
  });
  const doc = await task.promise;

  try {
    const meta = await doc.getMetadata().catch(() => ({ info: {} }));
    const info = meta.info || {};
    return {
      numPages: doc.numPages,
      title: (info.Title || '').trim(),
      author: (info.Author || '').trim(),
      subject: (info.Subject || '').trim(),
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
    standardFontDataUrl: STANDARD_FONTS,
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
  let text = '';
  if (extractText) text = await pageText(page);

  // Release the backing store; Safari in particular holds on to large canvases.
  canvas.width = canvas.height = 0;

  return { pageNumber, blob, width: viewport.width, height: viewport.height, text };
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
