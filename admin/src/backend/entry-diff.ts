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
