import { REPO } from "./config";
import { CONTENT_PREFIX, MEDIA_PREFIX, isDesignPath } from "./theme-fileset";

// In-browser theme EXPORT — the inverse of backend/theme.ts's import/apply. It
// reads the repo's current state through the GitHub proxy (tree API + blobs),
// filters to the selected file set, and builds a theme bundle
// (theme.json + files/<repo-path>, gzipped ustar) entirely client-side, then
// triggers a download. No server changes: whatever this produces round-trips
// back through parseTheme() unchanged.
//
// The tar/gzip writer here is runtime-neutral (Uint8Array + TextEncoder + native
// CompressionStream — no Buffer, no DOM) so it mirrors scripts/pack-theme.mjs and
// can be exercised under node in the round-trip test. Only the fetch + download
// helpers are browser-only.
//
// NOTE (dedup): the GitHub tree/blob reads below are inlined here (self-contained
// per the feature brief) rather than calling GitHubClient. If/when
// getTree(sha, recursive)/getBlob(sha) land on GitHubClient, these can be swapped
// for them.

const API = "/admin/api/gh";

// ── GitHub proxy reads (mirror backend/github.ts's request style) ────────────
async function gh(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    cache: "no-store", // a stale tree/blob would export the wrong bytes
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const raw = await res.text();
    let detail = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.message === "string") detail = parsed.message;
    } catch {
      /* non-JSON body — keep raw text */
    }
    throw new Error(`GitHub ${res.status}: ${detail}`);
  }
  return res.json();
}

interface TreeEntry {
  path: string;
  type: string; // "blob" | "tree"
  sha: string;
}

/** Resolve the branch's root tree sha (ref → commit → tree), like commitFiles. */
async function resolveTreeSha(): Promise<string> {
  const { branch } = REPO;
  const git = "/git";
  const ref = (await gh(`${git}/ref/heads/${branch}`)) as { object: { sha: string } };
  const commit = (await gh(`${git}/commits/${ref.object.sha}`)) as { tree: { sha: string } };
  return commit.tree.sha;
}

async function listTree(): Promise<TreeEntry[]> {
  const sha = await resolveTreeSha();
  const res = (await gh(`/git/trees/${sha}?recursive=1`)) as {
    tree: TreeEntry[];
    truncated?: boolean;
  };
  if (res.truncated) {
    throw new Error("The repository is too large to export in one pass (tree truncated).");
  }
  return res.tree;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\n/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchBlob(sha: string): Promise<Uint8Array> {
  const blob = (await gh(`/git/blobs/${sha}`)) as { content: string };
  return b64ToBytes(blob.content);
}

// ── file selection ───────────────────────────────────────────────────────────
export interface ExportSelection {
  content: boolean; // content/**
  media: boolean; // public/images/uploads/**
}

// Never export into a protected path, even if the tree somehow contained one
// (parseTheme would reject it on re-import anyway). Mirrors theme.ts's list.
const PROTECTED_PREFIXES = [".git/", ".github/", "functions/", "bot/"];
function isProtected(p: string): boolean {
  return PROTECTED_PREFIXES.some((x) => p === x.slice(0, -1) || p.startsWith(x));
}

function wanted(path: string, sel: ExportSelection): boolean {
  if (isProtected(path)) return false;
  if (isDesignPath(path)) return true; // design is always on
  if (sel.content && path.startsWith(CONTENT_PREFIX)) return true;
  if (sel.media && path.startsWith(MEDIA_PREFIX)) return true;
  return false;
}

// ── manifest ─────────────────────────────────────────────────────────────────
export interface ExportManifest {
  name: string;
  title: string;
  version?: string;
  description?: string;
}

function manifestJson(m: ExportManifest): Uint8Array {
  // Drop empty optional fields so theme.json stays clean.
  const out: Record<string, string> = { name: m.name.trim(), title: m.title.trim() };
  if (m.version?.trim()) out.version = m.version.trim();
  if (m.description?.trim()) out.description = m.description.trim();
  return new TextEncoder().encode(`${JSON.stringify(out, null, 2)}\n`);
}

// ── ustar tar writer (mirror of scripts/pack-theme.mjs, Uint8Array-based) ─────
const BLOCK = 512;
const ENC = new TextEncoder();

function writeField(buf: Uint8Array, off: number, len: number, str: string): void {
  const bytes = ENC.encode(str);
  buf.set(bytes.subarray(0, Math.min(bytes.length, len)), off);
}

function ustarHeader(name: string, prefix: string, size: number, mtime: number): Uint8Array {
  const h = new Uint8Array(BLOCK); // zero-filled
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

/** Split a >100-char path into ustar name (≤100) + prefix (≤155) on a "/". */
function splitName(path: string): { name: string; prefix: string } {
  if (path.length <= 100) return { name: path, prefix: "" };
  const cut = path.lastIndexOf("/", 100);
  if (cut <= 0 || path.length - cut - 1 > 100 || cut > 155) {
    throw new Error(`Path too long for ustar: ${path}`);
  }
  return { name: path.slice(cut + 1), prefix: path.slice(0, cut) };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function tarEntry(archivePath: string, data: Uint8Array): Uint8Array {
  const { name, prefix } = splitName(archivePath);
  // mtime 0 keeps bundles reproducible — nothing reads timestamps on import.
  const header = ustarHeader(name, prefix, data.length, 0);
  const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
  return concat([header, data, new Uint8Array(pad)]);
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Build a gzipped ustar theme bundle: theme.json at the root, then every file at
 * files/<repo-path>. Pure + runtime-neutral so the round-trip test can run it
 * under node. `files` paths are repo-relative (no files/ prefix).
 */
export async function packBundleGz(
  manifest: ExportManifest,
  files: { path: string; bytes: Uint8Array }[],
): Promise<Uint8Array> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const chunks: Uint8Array[] = [tarEntry("theme.json", manifestJson(manifest))];
  for (const f of sorted) {
    chunks.push(tarEntry(`files/${f.path}`, f.bytes));
  }
  chunks.push(new Uint8Array(BLOCK * 2)); // two zero blocks terminate the archive
  return gzip(concat(chunks));
}

// ── download (browser-only) ───────────────────────────────────────────────────
function triggerDownload(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/gzip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export the current site as a theme bundle and download it. `onProgress` fires
 * after each file's blob downloads (the slow part). Resolves to the file count.
 */
export async function exportTheme(
  manifest: ExportManifest,
  selection: ExportSelection,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const entries = (await listTree()).filter((e) => e.type === "blob" && wanted(e.path, selection));
  if (entries.length === 0) {
    throw new Error("Nothing to export — no files matched the selected options.");
  }
  const files: { path: string; bytes: Uint8Array }[] = [];
  let done = 0;
  for (const e of entries) {
    files.push({ path: e.path, bytes: await fetchBlob(e.sha) });
    onProgress?.(++done, entries.length);
  }
  const gz = await packBundleGz(manifest, files);
  triggerDownload(gz, `lanza-theme-${manifest.name}.tar.gz`);
  return files.length;
}
