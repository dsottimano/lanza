// What would publishing this entry actually change?
//
// The CMS writes to the working branch (`staging`) and publishes by merging into
// production (`main`), so those two refs hold two versions of the same file: the
// one the public site is built from, and the one that is waiting. This module
// loads both and reports the difference FIELD BY FIELD, which is the shape a
// human review needs — `compare` (ui/staging.ts) only counts files, and a blob
// diff of serialized YAML answers "which lines moved", not "which field changed".
//
// Field paths are dot-notation with numeric segments for array items
// (`slots.cards.0.heading`), i.e. exactly what a template placeholder resolves —
// see `resolve` in frontend/lib/template-render.ts, which walks a dotted path the
// same way and indexes arrays by their numeric key. So a path reported here can be
// pointed straight at the template slot it feeds.
//
// Nothing here throws for a file that isn't on one of the refs: a page that has
// never been published is the ORDINARY state of a draft, and one deleted on
// staging is the ordinary state of a pending removal. Both are statuses, not
// errors — same 404-vs-everything-else split `readPin` uses in version.ts.
import { GitHubError, type GitHubClient } from "./github";
import { parseFrontmatter } from "./frontmatter";
import { REPO } from "./config";

/** The prose/body of the entry, reported as a field under this path. */
export const BODY_FIELD = "body";

export type FieldStatus = "added" | "removed" | "changed" | "unchanged";

export interface FieldDiff {
  /** Dot-notation path, array items included: `title`, `slots.cards.0.heading`. */
  path: string;
  status: FieldStatus;
  /** Value on the production branch. `undefined` means the field isn't there. */
  live: unknown;
  /** Value on the working branch. `undefined` means the field isn't there. */
  staged: unknown;
}

export type EntryStatus =
  // Exists on both refs, and they differ / are identical.
  | "changed"
  | "unchanged"
  // Only on staging: never published. Distinct on purpose — "every field is new"
  // and "every field was edited" are different things to review.
  | "new"
  // Only on production: staging removed it, publishing would take it down.
  | "deleted"
  // On neither ref. A path that doesn't exist is not a failure to load one.
  | "absent";

export interface EntryDiff {
  path: string;
  status: EntryStatus;
  /**
   * Every leaf field, unchanged ones included, so a reviewer can render the whole
   * entry and not just the deltas. For `new` every field is `added` and for
   * `deleted` every field is `removed`; `absent` has none.
   */
  fields: FieldDiff[];
}

/** One ref's copy of the file: parsed frontmatter + body, or null if it's not there. */
interface EntryFile {
  data: Record<string, unknown>;
  body: string;
}

async function readEntry(
  client: GitHubClient,
  path: string,
  ref: string,
): Promise<EntryFile | null> {
  try {
    const { text } = await client.loadText(path, ref);
    const { data, body } = parseFrontmatter(text);
    // Trimmed because the two refs can disagree on surrounding blank lines alone:
    // serializeFrontmatter writes `\n\n<body>\n`, while a bot-written draft (raw
    // markdown, see markdown.ts) does not. That is not an edit anyone reviews.
    return { data, body: body.trim() };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

/** Load one entry from both branches and report what publishing would change. */
export async function loadEntryDiff(client: GitHubClient, path: string): Promise<EntryDiff> {
  const [live, staged] = await Promise.all([
    readEntry(client, path, REPO.productionBranch),
    readEntry(client, path, REPO.branch),
  ]);

  if (!live && !staged) return { path, status: "absent", fields: [] };

  const fields = diffFiles(live, staged);
  if (!live) return { path, status: "new", fields };
  if (!staged) return { path, status: "deleted", fields };
  const status = fields.some((f) => f.status !== "unchanged") ? "changed" : "unchanged";
  return { path, status, fields };
}

/**
 * Just the paths that differ, in report order — what the review UI hands the
 * preview to highlight. Derived from `fields`, so it needs no separate notion of
 * what counts as a change: `unchanged` is the only status that isn't one.
 *
 * A `new` entry returns every path (all `added`) and `absent` returns none, both
 * of which fall out of the field list rather than being special-cased here.
 */
export function changedPaths(diff: EntryDiff): string[] {
  return diff.fields.filter((f) => f.status !== "unchanged").map((f) => f.path);
}

/**
 * The field list for a pair of copies. A missing side is walked as an empty
 * record, so `new`/`deleted` fall out of the same walk as `added`/`removed` rows
 * rather than needing their own traversal.
 */
function diffFiles(live: EntryFile | null, staged: EntryFile | null): FieldDiff[] {
  const fields: FieldDiff[] = [];
  const liveData = live?.data ?? {};
  const stagedData = staged?.data ?? {};
  for (const key of unionKeys(liveData, stagedData)) {
    diffInto(key, liveData[key], stagedData[key], fields);
  }
  // Body last, so the list reads in file order: frontmatter, then the prose.
  diffInto(BODY_FIELD, live?.body, staged?.body, fields);
  return fields;
}

// Live keys in their own order first, then staging-only keys — so a reviewer sees
// the entry roughly as production has it, with the additions after.
function unionKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))];
}

function join(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

// A container we descend INTO. A Date is an object but has no own keys, so
// recursing into one compares nothing and every date pair reads as identical —
// datetime frontmatter (`publishDate: 2026-08-15`) is loaded as a Date by js-yaml,
// so that is the common case, not an exotic one. Treated as a leaf and compared by
// time below.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function equalLeaves(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * Compare one value pair and append leaf rows. `undefined` means ABSENT — YAML
 * never produces it (a key with no value loads as null), so it is unambiguous.
 *
 * Arrays are compared BY POSITION: a reorder is a change at each moved index, not
 * a no-op. The alternative — matching items by identity — would report a reordered
 * list of page blocks as unchanged, and the order is the layout.
 */
function diffInto(path: string, live: unknown, staged: unknown, out: FieldDiff[]): void {
  if (live === undefined && staged === undefined) return;
  if (live === undefined) {
    out.push({ path, status: "added", live, staged });
    return;
  }
  if (staged === undefined) {
    out.push({ path, status: "removed", live, staged });
    return;
  }

  if (isRecord(live) && isRecord(staged)) {
    const before = out.length;
    for (const key of unionKeys(live, staged)) {
      diffInto(join(path, key), live[key], staged[key], out);
    }
    // Two empty objects produce no rows at all, which would drop the field from
    // the report entirely. Keep it visible as one unchanged leaf.
    if (out.length === before) out.push({ path, status: "unchanged", live, staged });
    return;
  }

  if (Array.isArray(live) && Array.isArray(staged)) {
    const before = out.length;
    for (let i = 0; i < Math.max(live.length, staged.length); i++) {
      diffInto(join(path, String(i)), live[i], staged[i], out);
    }
    if (out.length === before) out.push({ path, status: "unchanged", live, staged });
    return;
  }

  // Leaves, and any type swap (object ↔ array ↔ scalar): report the whole values,
  // since there is no sensible per-key path across a change of shape.
  out.push({ path, status: equalLeaves(live, staged) ? "unchanged" : "changed", live, staged });
}

// ── putting one field back ───────────────────────────────────────────────────

export interface RevertResult {
  data: Record<string, unknown>;
  body: string;
}

// Not `structuredClone`, which would be the stdlib answer: the editor's `data` is a
// Vue `reactive()` object, i.e. a Proxy, and structured cloning a Proxy throws
// DataCloneError. Anything reached from it can be one too, so the clone has to be
// one that reads through proxies — which an ordinary walk does.
function cloneValue<T>(v: T): T {
  if (v instanceof Date) return new Date(v.getTime()) as T;
  if (Array.isArray(v)) return v.map(cloneValue) as T;
  if (isRecord(v)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v)) out[key] = cloneValue(v[key]);
    return out as T;
  }
  return v;
}

// The path led somewhere that no longer exists. Distinct from "the new value is
// undefined", which is what a revert of an `added` field legitimately produces.
const NOT_FOUND = Symbol("not-found");

/**
 * Put ONE field back to what the live site says, purely: the inputs are never
 * mutated and a new `data` is returned with the containers along that path copied.
 * The caller applies the result (the editor's `data` is reactive — mutating it here
 * would edit the page behind the reviewer's back).
 *
 * The restored value is deep-cloned, so nothing in the returned data is the same
 * object as `field.live`. Sharing it would let a later edit rewrite the diff's own
 * record of what production says, and the reviewer would be reading their own edit
 * back as if it were the live site. Untouched subtrees ARE shared with `data` —
 * they were already in the caller's graph and nothing here writes to them.
 *
 * A container path restores the whole subtree, which needs no special case: an
 * added/removed row carries the entire container as its value, and setting it is
 * the same operation as setting a leaf.
 */
export function revertValue(
  data: Record<string, unknown>,
  body: string,
  field: FieldDiff,
): RevertResult {
  // Identity is preserved on a no-op, so a caller can tell nothing happened.
  const unchanged: RevertResult = { data, body };
  if (field.status === "unchanged") return unchanged;

  // The body is not in `data` at all — it's the prose after the frontmatter.
  if (field.path === BODY_FIELD) {
    return { data, body: typeof field.live === "string" ? field.live : "" };
  }

  const next = revertIn(data, field.path.split("."), field);
  return next === NOT_FOUND ? unchanged : { data: next as Record<string, unknown>, body };
}

/**
 * Walk to the field, copying each container on the way down and rebuilding on the
 * way back up. Anything the path doesn't actually lead to returns NOT_FOUND rather
 * than conjuring the missing containers: the entry may have moved on since the diff
 * was taken (another revert, another edit), and inventing an empty `seo:` to hold a
 * description that no longer belongs anywhere writes a field the reviewer never
 * asked for.
 */
function revertIn(node: unknown, parts: string[], field: FieldDiff): unknown | typeof NOT_FOUND {
  const [head, ...rest] = parts;

  if (Array.isArray(node)) {
    if (!/^\d+$/.test(head)) return NOT_FOUND;
    const i = Number(head);
    if (rest.length === 0) return revertArrayItem(node, i, field);
    if (i >= node.length) return NOT_FOUND;
    const child = revertIn(node[i], rest, field);
    if (child === NOT_FOUND) return NOT_FOUND;
    const copy = node.slice();
    copy[i] = child;
    return copy;
  }

  if (isRecord(node)) {
    if (rest.length === 0) return revertKey(node, head, field);
    if (!(head in node)) return NOT_FOUND;
    const child = revertIn(node[head], rest, field);
    if (child === NOT_FOUND) return NOT_FOUND;
    return { ...node, [head]: child };
  }

  return NOT_FOUND;
}

function revertKey(node: Record<string, unknown>, key: string, field: FieldDiff): unknown {
  // Added: there is no live value, so putting it back means the key is not there.
  if (field.status === "added") {
    if (!(key in node)) return NOT_FOUND; // already gone — nothing to do
    const copy = { ...node };
    delete copy[key];
    return copy;
  }
  // Changed needs something to change; removed is ABSENT on staging by definition,
  // so its key is expected to be missing and gets written back.
  if (field.status === "changed" && !(key in node)) return NOT_FOUND;
  return { ...node, [key]: cloneValue(field.live) };
}

/**
 * The same three cases inside an array, where position is the identity.
 *
 * Removing splices rather than leaving a hole. A hole is worse than it looks: it
 * serializes to YAML as a `null` item, and the site would render an empty card
 * where the reviewer asked for nothing at all.
 *
 * Splicing shifts every later index, which would normally invalidate the other
 * paths in the same report — but an `added` index can only ever be a TRAILING one.
 * The differ reports `added` at index i only when i >= live.length (see diffInto),
 * so there is no live item after it to re-point. The one real hazard is two added
 * rows on the SAME array: reverting the lower index first moves the higher one, so
 * the caller must re-take the diff after each revert. It does — a revert is a save,
 * and the panel reloads from the branches.
 */
function revertArrayItem(node: unknown[], i: number, field: FieldDiff): unknown {
  if (field.status === "added") {
    if (i >= node.length) return NOT_FOUND;
    const copy = node.slice();
    copy.splice(i, 1);
    return copy;
  }
  if (field.status === "removed") {
    // Insert rather than assign, and never past the end: assigning index 3 of a
    // 1-item array leaves holes at 1 and 2. Clamping means restoring several
    // removed items converges on the live list whichever order they're clicked in.
    const copy = node.slice();
    copy.splice(Math.min(i, copy.length), 0, cloneValue(field.live));
    return copy;
  }
  if (i >= node.length) return NOT_FOUND;
  const copy = node.slice();
  copy[i] = cloneValue(field.live);
  return copy;
}
