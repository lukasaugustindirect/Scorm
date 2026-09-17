pdf.js (pdfjs-dist) 3.11.174 legacy/classic build - Apache-2.0

The served converter uses the modern ESM build in ../. This classic UMD build
exists only for the single-file variant: a file:// page may start a classic
Web Worker but not a module one, and 3.11.174 is the last release shipping a
non-module worker.
