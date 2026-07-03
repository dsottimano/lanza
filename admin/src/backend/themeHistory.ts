import type {
  GitHubClient,
  CommitFile,
  TreeEntry,
} from "./github";
import { REPO } from "./config";

// Theme revert. Every theme apply is exactly ONE commit (see theme.ts):
//   lanza: apply theme "<title>" v<version>
// So a revert is one inverse commit computed from git history — no snapshots.
// For each file the apply MODIFIED, we restore the blob it had in the apply's
// PARENT commit (referencing that blob sha directly — no download/re-upload).
// For each file the apply ADDED, we delete it. If a file was edited again after
// the apply, reverting overwrites those edits — we flag it as a conflict so the
// UI can warn by name.

const APPLY_PREFIX = "lanza: apply theme";

export interface AppliedTheme {
  sha: string;
  title: string;
  version?: string;
  date: string; // ISO timestamp of the commit
}

export interface RevertPlan {
  applySha: string;
  title: string;
  // Restore these paths to the blob they had before the apply.
  restore: { path: string; sha: string }[];
  // Delete these paths (the apply created them).
  remove: string[];
  // Paths in the revert set that were edited after the apply — reverting
  // overwrites those later edits.
  conflicts: string[];
}

// Parse a commit's first line: `lanza: apply theme "Title" v1.2` → title/version.
function parseApply(sha: string, message: string, date: string): AppliedTheme | null {
  const line = message.split("\n", 1)[0];
  if (!line.startsWith(APPLY_PREFIX)) return null;
  const m = line.match(/^lanza: apply theme "(.*)"(?: v(.+))?$/);
  if (!m) return { sha, title: line.slice(APPLY_PREFIX.length).trim(), date };
  return { sha, title: m[1], version: m[2], date };
}

/** Recent theme-apply commits, newest first. */
export async function listAppliedThemes(
  client: GitHubClient,
  limit = 30,
): Promise<AppliedTheme[]> {
  const commits = await client.listCommits(limit);
  const out: AppliedTheme[] = [];
  for (const c of commits) {
    const t = parseApply(c.sha, c.commit.message, c.commit.author.date);
    if (t) out.push(t);
  }
  return out;
}

// Pure inverse-set computation: given the apply commit's changed files, a
// path→blob-sha map of the PARENT tree, and the set of paths edited since the
// apply, produce the restore/remove/conflict lists. Exported for unit testing.
export function computeRevertSet(
  files: CommitFile[],
  parentBlobs: Map<string, string>,
  changedSince: Set<string>,
): Omit<RevertPlan, "applySha" | "title"> {
  const restore: { path: string; sha: string }[] = [];
  const remove: string[] = [];

  for (const f of files) {
    if (f.status === "added") {
      // The apply created this path → undo by deleting it.
      remove.push(f.filename);
    } else {
      // modified / removed / changed / renamed → restore the pre-apply blob.
      // (applyTheme only ever adds or modifies, but restore is correct for any
      // path the parent had.)
      const sha = parentBlobs.get(f.filename);
      if (sha === undefined) {
        throw new Error(
          `Cannot revert: "${f.filename}" has no blob in the apply's parent commit.`,
        );
      }
      restore.push({ path: f.filename, sha });
    }
  }

  const revertPaths = [...restore.map((r) => r.path), ...remove];
  const conflicts = revertPaths.filter((p) => changedSince.has(p));
  return { restore, remove, conflicts };
}

/**
 * Plan a revert of one theme-apply commit. Throws (clear message) if the commit
 * isn't an ancestor of the current branch head — reverting a non-ancestor commit
 * would corrupt history.
 */
export async function planRevert(
  client: GitHubClient,
  applySha: string,
): Promise<RevertPlan> {
  const commit = await client.getCommit(applySha);
  const parent = commit.parents[0];
  if (!parent) {
    throw new Error("Cannot revert the initial commit (it has no parent).");
  }
  const files = commit.files ?? [];
  if (files.length === 0) {
    throw new Error("This commit changed no files — nothing to revert.");
  }

  const title =
    parseApply(commit.sha, commit.commit.message, commit.commit.author.date)?.title ??
    "theme";

  // Ancestor guard + conflict detection in one compare: base=apply, head=branch.
  // `status` is "ahead"/"identical" iff the apply is an ancestor of HEAD; its
  // `files` are exactly the paths changed by commits AFTER the apply.
  const diff = await client.compare(applySha, REPO.branch);
  if (diff.status !== "ahead" && diff.status !== "identical") {
    throw new Error(
      `Cannot revert: this apply isn't in the current history (compare status "${diff.status}"). ` +
        "It may have already been reverted or rewritten.",
    );
  }
  const changedSince = new Set((diff.files ?? []).map((f) => f.filename));

  // The parent's tree gives the pre-apply blob sha for every restored path.
  const parentCommit = await client.getCommit(parent.sha);
  const tree = await client.getTree(parentCommit.commit.tree.sha, true);
  if (tree.truncated) {
    throw new Error("Cannot revert: the repository tree is too large to read in full.");
  }
  const parentBlobs = new Map<string, string>();
  for (const e of tree.tree) {
    if (e.type === "blob") parentBlobs.set(e.path, e.sha);
  }

  const set = computeRevertSet(files, parentBlobs, changedSince);
  return { applySha, title, ...set };
}

/** Execute a revert plan as ONE commit referencing existing blobs + deletions. */
export async function executeRevert(
  client: GitHubClient,
  plan: RevertPlan,
): Promise<string> {
  const entries: TreeEntry[] = [
    ...plan.restore.map(
      (r) => ({ path: r.path, mode: "100644", type: "blob", sha: r.sha }) as TreeEntry,
    ),
    ...plan.remove.map(
      (p) => ({ path: p, mode: "100644", type: "blob", sha: null }) as TreeEntry,
    ),
  ];
  const message = `lanza: revert theme "${plan.title}"`;
  return client.commitTreeChanges(entries, message);
}
