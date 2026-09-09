#!/usr/bin/env node
// Development server: static files, plus a stub LRS for the test harness.
//
// The converter has to be served over http:// rather than opened as a file://
// document: pdf.js runs its parser in a Web Worker, and browsers refuse to
// start a worker from a file:// origin. Any static host will do for the
// converter itself -- this script exists so that `npm start` works without
// installing anything.
//
// The /_lrs/ endpoints are the part a plain static host cannot provide. They
// stand in for an LMS's xAPI endpoints so a built package can be exercised
// without a real LRS: statements are kept in memory and can be read back, and
// the cmi5 launch handshake (fetch URL, LMS.LaunchData State document) works
// end to end. It is a test double, not an LRS: no auth enforcement, no
// querying, no persistence, and nothing here should face a network.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const PACKAGES = join(ROOT, 'packages');
const MAX_BODY = 8 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.xsd': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.ttf': 'font/ttf',
  '.pfb': 'application/x-font-type1',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/* ---------------- stub LRS state ---------------- */

const lrs = {
  statements: [],
  states: new Map(),
  tokensIssued: 0,
};

// A State document is addressed by the tuple the xAPI State API uses.
function stateKey(query) {
  return [
    query.get('activityId') || '',
    query.get('agent') || '',
    query.get('stateId') || '',
    query.get('registration') || '',
  ].join('|');
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      // A test double has no business buffering an unbounded upload.
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleLrs(req, res, url) {
  const path = url.pathname.replace(/^\/_lrs\/?/, '');
  const query = url.searchParams;

  // The harness and the SCO share an origin here, but a real LMS would not,
  // so the headers the adapters send have to survive a preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Experience-API-Version',
    });
    res.end();
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  // --- cmi5 authorisation token fetch ---
  // Must be POST: cmi5 forbids GET so the response cannot be cached.
  if (path === 'token') {
    if (req.method !== 'POST') {
      json(res, 405, { 'error-code': '1', 'error-text': 'fetch URL requires POST' });
      return;
    }
    lrs.tokensIssued++;
    json(res, 200, { 'auth-token': Buffer.from(`harness:${randomUUID()}`).toString('base64') });
    return;
  }

  // --- statements ---
  if (path === 'statements') {
    if (req.method === 'POST') {
      let parsed;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch (err) {
        json(res, 400, { message: `unparseable statement: ${err.message}` });
        return;
      }
      const incoming = Array.isArray(parsed) ? parsed : [parsed];
      const ids = [];
      for (const statement of incoming) {
        const id = statement.id || randomUUID();
        lrs.statements.push({ ...statement, id, storedAt: new Date().toISOString() });
        ids.push(id);
      }
      json(res, 200, ids);
      return;
    }
    if (req.method === 'GET') {
      // Introspection for the harness and the tests. Deliberately not the
      // xAPI statement-query API: it returns everything, oldest first.
      json(res, 200, { statements: lrs.statements });
      return;
    }
    json(res, 405, { message: 'method not allowed' });
    return;
  }

  // --- State API ---
  if (path === 'activities/state') {
    const key = stateKey(query);
    if (req.method === 'PUT' || req.method === 'POST') {
      lrs.states.set(key, await readBody(req));
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'GET') {
      if (!lrs.states.has(key)) {
        res.writeHead(404).end();
        return;
      }
      const body = lrs.states.get(key);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    if (req.method === 'DELETE') {
      lrs.states.delete(key);
      res.writeHead(204).end();
      return;
    }
    json(res, 405, { message: 'method not allowed' });
    return;
  }

  // --- harness helpers ---
  if (path === 'reset' && req.method === 'POST') {
    lrs.statements = [];
    lrs.states.clear();
    lrs.tokensIssued = 0;
    json(res, 200, { reset: true });
    return;
  }

  if (path === 'packages' && req.method === 'GET') {
    // A package is any directory under packages/ carrying an index.html.
    try {
      const entries = await readdir(PACKAGES, { withFileTypes: true });
      const found = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          await stat(join(PACKAGES, entry.name, 'index.html'));
          found.push(entry.name);
        } catch {
          // A directory with no index.html is not a package.
        }
      }
      json(res, 200, { packages: found.sort() });
    } catch {
      json(res, 200, { packages: [] });
    }
    return;
  }

  json(res, 404, { message: `no such stub endpoint: ${path}` });
}

/* ---------------- static files ---------------- */

async function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  // normalize() collapses ".." so a crafted path cannot escape ROOT.
  const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const info = await stat(path);
  if (!info.isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  createReadStream(path).pipe(res);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/_lrs')) {
      await handleLrs(req, res, url);
      return;
    }
    await handleStatic(req, res, url);
  } catch {
    if (!res.headersSent) res.writeHead(404).end('Not found');
    else res.end();
  }
}).listen(PORT, () => {
  console.log(`PDF to SCORM converter running at http://localhost:${PORT}/`);
  console.log(`Test harness at                  http://localhost:${PORT}/harness/`);
});
