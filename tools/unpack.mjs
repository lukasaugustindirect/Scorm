#!/usr/bin/env node
// Extracts a built package into packages/<name>/ so the harness can run it.
//
//   node tools/unpack.mjs path/to/course-scorm12.zip [name]
//
// Node has no zip reader, and the point of this repo is that it needs nothing
// installed, so the format is parsed here: read the central directory, then
// inflate each entry. Only the two methods JSZip actually emits are supported
// (stored and deflate), which is all a package built by this tool contains.

import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATE = 8;

/** @returns {Array<{name: string, data: Buffer}>} */
export function readZip(buffer) {
  // The EOCD sits at the end, after a comment of unknown length, so it has to
  // be found by scanning backwards for its signature.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff) {
    throw new Error('Zip64 archives are not supported by this unpacker');
  }

  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL) {
      throw new Error(`corrupt central directory at entry ${n}`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;

    if (buffer.readUInt32LE(localOffset) !== LOCAL) {
      throw new Error(`corrupt local header for ${name}`);
    }
    // The local header repeats the name and extra fields, and its own extra
    // length can differ from the central directory's, so read it from here.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);

    let data;
    if (method === STORED) data = Buffer.from(raw);
    else if (method === DEFLATE) data = inflateRawSync(raw);
    else throw new Error(`${name}: unsupported compression method ${method}`);

    entries.push({ name, data });
  }
  return entries;
}

/** Rejects absolute paths and traversal, so a crafted zip cannot write outside. */
function safeJoin(base, name) {
  const target = resolve(base, name);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`refusing to write outside the target directory: ${name}`);
  }
  return target;
}

async function main() {
  const [zipPath, explicitName] = process.argv.slice(2);
  if (!zipPath) {
    console.error('usage: node tools/unpack.mjs <package.zip> [name]');
    process.exit(2);
  }

  const name = explicitName || basename(zipPath).replace(/\.zip$/i, '');
  const target = resolve(join(ROOT, 'packages', name));
  if (!target.startsWith(resolve(join(ROOT, 'packages')) + sep)) {
    console.error('the package name must not contain path separators');
    process.exit(2);
  }

  const entries = readZip(await readFile(zipPath));
  await rm(target, { recursive: true, force: true });

  for (const entry of entries) {
    const file = safeJoin(target, entry.name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, entry.data);
  }

  const total = entries.reduce((sum, e) => sum + e.data.length, 0);
  console.log(`unpacked ${entries.length} files (${(total / 1024).toFixed(0)} kB) ` +
              `to packages/${name}/`);
  console.log('open the harness and pick it from the list');
}

// Only run as a script; readZip is imported by the test suite.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
