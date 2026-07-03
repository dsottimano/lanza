#!/usr/bin/env node
// Pack a Lanza theme source directory into a bundle the CMS can apply.
//
//   node scripts/pack-theme.mjs <src-dir> [out.tar.gz]
//
// <src-dir> must contain `theme.json` (manifest) and a `files/` tree whose
// paths mirror the repo (files/frontend/…, files/admin/…, files/public/…). The
// output is a gzipped ustar tarball with `theme.json` and `files/**` at the
// archive ROOT — exactly the shape the in-browser reader in
// admin/src/backend/theme.ts expects (regular-file entries, forward-slash
// relative paths, no leading "./"). Uses only Node builtins (no tar/gzip dep):
// a hand-rolled ustar writer + zlib.gzipSync.
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

const BLOCK = 512;

/** Recursively list files under `dir`, returned as absolute paths. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Write `str` into `buf` at `off`, NUL-padded to `len` (truncates if longer). */
function writeField(buf, off, len, str) {
  const bytes = Buffer.from(str, "utf8");
  bytes.copy(buf, off, 0, Math.min(bytes.length, len));
}

/** A ustar header for a regular file. `name`/`prefix` already split to fit. */
function ustarHeader(name, prefix, size, mtime) {
  const h = Buffer.alloc(BLOCK); // zero-filled
  writeField(h, 0, 100, name);
  writeField(h, 100, 8, "0000644\0"); // mode
  writeField(h, 108, 8, "0000000\0"); // uid
  writeField(h, 116, 8, "0000000\0"); // gid
  writeField(h, 124, 12, size.toString(8).padStart(11, "0") + "\0");
  writeField(h, 136, 12, Math.floor(mtime).toString(8).padStart(11, "0") + "\0");
  writeField(h, 156, 1, "0"); // typeflag: regular file
  writeField(h, 257, 6, "ustar\0");
  writeField(h, 263, 2, "00"); // version
  writeField(h, 345, 155, prefix);

  // Checksum: sum of all header bytes with the checksum field taken as spaces.
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  writeField(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

/**
 * Split a >100-char path into ustar name (≤100) + prefix (≤155) on a "/"
 * boundary, per the ustar spec. Throws if it cannot fit (very deep path).
 */
function splitName(path) {
  if (path.length <= 100) return { name: path, prefix: "" };
  const cut = path.lastIndexOf("/", 100);
  if (cut <= 0 || path.length - cut - 1 > 100 || cut > 155) {
    throw new Error(`Path too long for ustar: ${path}`);
  }
  return { name: path.slice(cut + 1), prefix: path.slice(0, cut) };
}

function tarEntry(archivePath, data, mtime) {
  const { name, prefix } = splitName(archivePath);
  const header = ustarHeader(name, prefix, data.length, mtime);
  const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
  return Buffer.concat([header, data, Buffer.alloc(pad)]);
}

function main() {
  const [srcDir, outArg] = process.argv.slice(2);
  if (!srcDir) {
    console.error("usage: node scripts/pack-theme.mjs <src-dir> [out.tar.gz]");
    process.exit(1);
  }
  const manifestPath = join(srcDir, "theme.json");
  const filesDir = join(srcDir, "files");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.name || !manifest.title) {
    throw new Error("theme.json must include \"name\" and \"title\".");
  }
  const out = outArg || `${manifest.name}.tar.gz`;

  // Archive entries: theme.json first, then every files/** entry. Paths are
  // relative to srcDir with forward slashes, no leading "./".
  // mtime 0 keeps bundles byte-reproducible: packing the same source twice
  // yields an identical tarball (nothing reads the timestamps on import).
  const mtime = 0;
  const chunks = [];
  const toArchivePath = (abs) => relative(srcDir, abs).split(sep).join("/");

  chunks.push(tarEntry("theme.json", readFileSync(manifestPath), mtime));
  const files = walk(filesDir).sort();
  for (const abs of files) {
    chunks.push(tarEntry(toArchivePath(abs), readFileSync(abs), mtime));
  }
  chunks.push(Buffer.alloc(BLOCK * 2)); // two zero blocks terminate the archive

  const gz = gzipSync(Buffer.concat(chunks), { level: 9 });
  writeFileSync(out, gz);
  console.log(`Packed ${files.length + 1} entries → ${out} (${gz.length} bytes)`);
}

main();
