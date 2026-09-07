// A path check on POST git/trees cannot describe the final commit: a caller can
// omit base_tree or reuse another tree. Authorize the complete immutable result
// at the point it becomes visible. No credentials or request state are retained.
import { editorWritablePath, type Decision, type EditorPolicy } from "./roles";

type Read = (path: string) => Promise<unknown>;
type Entry = { path: string; mode: string; type: string; sha: string };
const SHA = /^[a-f0-9]{40}$/;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Incomplete GitHub response.");
  return value as Record<string, unknown>;
};
function sha(value: unknown): string {
  if (typeof value !== "string" || !SHA.test(value)) throw new Error("Invalid Git object ID.");
  return value;
}
function tree(value: unknown): Map<string, Entry> {
  const data = record(value);
  if (data.truncated !== false || !Array.isArray(data.tree)) throw new Error("Cannot verify the complete repository tree.");
  const entries = new Map<string, Entry>();
  for (const item of data.tree) {
    const e = record(item);
    if (typeof e.path !== "string" || typeof e.mode !== "string" || typeof e.type !== "string" || entries.has(e.path)) {
      throw new Error("Malformed repository tree.");
    }
    sha(e.sha);
    // Directory hashes necessarily change with their children. Inspect leaves,
    // including symlinks and submodules, rather than approving a changed subtree.
    if (e.type === "tree" && e.mode === "040000") continue;
    entries.set(e.path, e as Entry);
  }
  return entries;
}

export async function editorRefAllowed(
  method: string, path: string, body: unknown, policy: EditorPolicy, read: Read,
): Promise<Decision> {
  const p = path.replace(/[?#].*$/, "").replace(/^\/+/, "");
  const creating = method === "POST" && p === "git/refs";
  const updating = method === "PATCH" && p === `git/refs/heads/${policy.workingBranch}`;
  if (!creating && !updating) return { ok: true };
  const input = record(body);
  if (input.force !== undefined && input.force !== false) return { ok: false, reason: "An editor cannot force-update drafts." };
  const candidate = sha(input.sha);
  if (creating) {
    // Creating an absent branch may only copy production. GitHub rejects an
    // already-existing ref, so this cannot reset an existing draft.
    const production = record(await read(`git/ref/heads/${policy.productionBranch}`));
    return { ok: input.ref === `refs/heads/${policy.workingBranch}` && candidate === sha(record(production.object).sha),
      reason: "New drafts must start from production." };
  }
  const current = record(await read(`git/ref/heads/${policy.workingBranch}`));
  const head = sha(record(current.object).sha);
  if (candidate === head) return { ok: true };
  const next = record(await read(`git/commits/${candidate}`));
  if (!Array.isArray(next.parents) || next.parents.length !== 1 || record(next.parents[0]).sha !== head) {
    return { ok: false, reason: "Drafts changed or the commit has unreviewed history. Reload before saving." };
  }
  const previous = record(await read(`git/commits/${head}`));
  const [before, after] = await Promise.all([
    read(`git/trees/${sha(record(previous.tree).sha)}?recursive=1`).then(tree),
    read(`git/trees/${sha(record(next.tree).sha)}?recursive=1`).then(tree),
  ]);
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(path), changed = after.get(path);
    if (old?.sha === changed?.sha && old?.mode === changed?.mode && old?.type === changed?.type) continue;
    if (!editorWritablePath(path) || (changed && (changed.type !== "blob" || changed.mode !== "100644"))) {
      return { ok: false, reason: `Only an owner can change ${path}.` };
    }
  }
  // A SINGLE parent pinned to head + GitHub's non-force ref update closes the
  // race after these reads. Another writer's sibling commit cannot be overwritten.
  return { ok: true };
}
