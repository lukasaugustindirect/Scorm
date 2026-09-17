// XML text helpers.
//
// Course titles come from a PDF's metadata or a free-text field, so every
// interpolated value has to be escaped: an unescaped "&" in a course name is
// the classic reason an LMS rejects a package as malformed.

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// XML 1.0 forbids most control characters outright, and no escape can smuggle
// them in, so they have to be dropped rather than encoded.
export function clean(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .trim();
}

export function text(value) {
  return esc(clean(value));
}

// Identifiers in a manifest are xs:ID: they must start with a letter or an
// underscore and contain no spaces or colons.
export function id(value, fallback) {
  const slug = clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback || 'course';
}

// An IRI for xAPI and cmi5 activity ids. When the user supplies no absolute
// IRI of their own, fall back to a URN so the value is still legal.
export function iri(value, fallbackSlug) {
  const trimmed = clean(value);
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return 'urn:pdf-to-scorm:' + id(fallbackSlug, 'course').toLowerCase();
}

export const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
