import type { GitHubClient } from "./github";
import { CONTENT_PREFIX, MEDIA_PREFIX, isDesignPath } from "./theme-fileset";

// Prebuilt-theme support. A Lanza theme is a gzipped tarball:
//
//   theme.json          ← manifest (name, title, version, description, …)
//   files/<repo-path>   ← every file the theme ships, at its real repo path
//                         (e.g. files/frontend/styles/site.css)
//
// Applying a theme decompresses the bundle IN THE BROWSER (native gzip + a tiny
// ustar reader — no dependency), then commits every files/* entry in ONE commit
// (GitHubClient.commitFiles → Git Data API), which triggers a single Cloudflare
// Pages rebuild. New paths are created, existing paths overwritten; nothing else
// in the repo is touched.

export interface ThemeManifest {
  name: string; // machine id, e.g. "ocean"
  title: string; // display name, e.g. "Ocean"
  version?: string;
  description?: string;
  author?: string;
  rebuildNote?: string; // e.g. "Changes the content schema — the CMS rebuilds."
}

export interface ParsedTheme {
  manifest: ThemeManifest;
  files: { path: string; base64: string }[]; // repo paths (files/ prefix stripped)
}

// ── gzip (native) ────────────────────────────────────────────────────────
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ── ustar reader ───────────────────────────────────────────────────────────
// Just enough of the tar format to pull regular files out: 512-byte header
// blocks, octal sizes, the ustar `prefix` field (long paths), and the GNU `L`
// long-name extension. Directories and pax headers are skipped.
interface TarEntry {
  name: string;
  bytes: Uint8Array;
}

const DECODER = new TextDecoder();

function readStr(b: Uint8Array, off: number, len: number): string {
  let end = off;
  const max = off + len;
  while (end < max && b[end] !== 0) end++;
  return DECODER.decode(b.subarray(off, end));
}

function readOctal(b: Uint8Array, off: number, len: number): number {
  const s = readStr(b, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}

function untar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let off = 0;
  let longName: string | null = null;

  while (off + 512 <= buf.length) {
    if (buf[off] === 0) break; // zero block → end of archive

    let name = readStr(buf, off, 100);
    const size = readOctal(buf, off + 124, 12);
    const type = String.fromCharCode(buf[off + 156] || 0);
    const prefix = readStr(buf, off + 345, 155);
    if (prefix) name = `${prefix}/${name}`;

    off += 512;
    const data = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;

    if (type === "L") {
      // GNU long name: this block's data is the *next* entry's full path.
      longName = DECODER.decode(data).replace(/\0+$/, "");
      continue;
    }
    if (type === "x" || type === "g") continue; // pax extended headers — ignore
    if (longName) {
      name = longName;
      longName = null;
    }
    // "0" / NUL / "" are all regular files.
    if (type === "0" || type === "\0" || type === "") {
      entries.push({ name, bytes: data });
    }
  }
  return entries;
}

// ── base64 (chunked, binary-safe) ────────────────────────────────────────
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000; // avoid String.fromCharCode arg-count limits on big files
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const stripLead = (p: string) => p.replace(/^\.\//, "");

// Theme bundles are UNTRUSTED uploads. A bundle commits to the repo, so a bad
// path is an arbitrary-repo-write. This is an ALLOW-list, and the allowed set is
// exactly what backend/export.ts can PRODUCE: isDesignPath() from theme-fileset
// (the design), plus the exporter's two opt-in "site dump" prefixes, content/ and
// public/images/uploads/. One definition, both directions: nothing can be
// imported that could not have been exported, and the export→re-import round trip
// keeps working. The two dump prefixes are inert data — markdown entries (rendered
// through frontend/lib/sanitize.ts) and media — not build inputs.
//
// It used to be a deny-list (".git/", ".github/", "functions/", "bot/"), which
// left four things writable that are not design at all:
//   - package.json      → a `postinstall`, or repointing the lanza-site dependency
//                         at an arbitrary tarball. The Pages build command IS this
//                         file's `build` script, so that is direct build execution,
//                         and it also defeats the CMS's unsafe-version blocking.
//   - astro.config.mjs  → imported by the build → build-time code execution.
//   - lanza.config.json → decides who owns /admin (functions/admin/_middleware.ts
//                         reads `adminLogin` from it). A theme shipping
//                         "adminLogin":"attacker" hands over the CMS, the GitHub
//                         proxy and the Cloudflare token on the next deploy. That is
//                         a persistent AUTHORIZATION change, categorically worse
//                         than the build-time execution a theme already implies.
//   - data/schema.json  → compiled into build code by scripts/gen-content-config.mjs.
//
// data/schema.json stays IN the allow-list: shipping a content model is a real
// theme feature (that is why the exporter packs it). What makes that safe is the
// generator, which now validates every value that reaches a code position rather
// than trusting the file — see scripts/gen-content-config.mjs.
//
// Residual, unchanged and accepted: the design itself is code — frontend/pages,
// components and layouts are .astro compiled by the build — so applying a theme
// still means trusting its author with the build. The point of the allow-list is
// that it no longer means trusting them with WHO OWNS THE SITE. (The gate on
// /admin is the session middleware in functions/admin/_middleware.ts —
// Cloudflare Access, which an earlier version of this comment cited, is no longer
// in the picture. See CLAUDE.md Rule 4.) The UI still warns before applying.
function assertSafeRepoPath(rel: string): void {
  if (!rel || rel.includes("\0") || rel.includes("\\") || rel.startsWith("/")) {
    throw new Error(`Theme bundle has an illegal file path: "${rel}"`);
  }
  if (rel.split("/").some((seg) => seg === "..")) {
    throw new Error(`Theme bundle path escapes the repo (..): "${rel}"`);
  }
  const allowed =
    isDesignPath(rel) || rel.startsWith(CONTENT_PREFIX) || rel.startsWith(MEDIA_PREFIX);
  if (!allowed) {
    throw new Error(
      `Theme may only write design files — "${rel}" is outside the theme file set.`,
    );
  }
}

/** Decompress + parse an uploaded theme bundle. Throws on a malformed bundle. */
export async function parseTheme(file: File): Promise<ParsedTheme> {
  let entries: TarEntry[];
  try {
    entries = untar(await gunzip(new Uint8Array(await file.arrayBuffer())));
  } catch {
    throw new Error("Couldn't read the bundle — expected a gzipped tar (.tar.gz).");
  }

  const manifestEntry = entries.find((e) => stripLead(e.name) === "theme.json");
  if (!manifestEntry) {
    throw new Error("Not a Lanza theme: theme.json is missing from the bundle root.");
  }
  let manifest: ThemeManifest;
  try {
    manifest = JSON.parse(DECODER.decode(manifestEntry.bytes));
  } catch {
    throw new Error("theme.json is not valid JSON.");
  }
  if (!manifest.name || !manifest.title) {
    throw new Error('theme.json must include "name" and "title".');
  }

  const payload = entries
    .map((e) => ({ name: stripLead(e.name), bytes: e.bytes }))
    .filter((e) => e.name.startsWith("files/") && e.name !== "files/");
  const files = payload.map((e) => {
    const path = e.name.slice("files/".length);
    assertSafeRepoPath(path); // reject traversal / protected paths before any commit
    return { path, base64: bytesToB64(e.bytes) };
  });
  if (files.length === 0) {
    throw new Error("Theme bundle has no files/ payload — nothing to apply.");
  }

  return { manifest, files };
}

/** Commit the whole theme in one commit; resolves to the new commit sha. */
export async function applyTheme(
  client: GitHubClient,
  theme: ParsedTheme,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const { title, version } = theme.manifest;
  const message = `lanza: apply theme "${title}"${version ? ` v${version}` : ""}`;
  return client.commitFiles(theme.files, message, onProgress);
}
