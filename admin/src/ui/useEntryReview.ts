// Reviewing an entry: what publishing it would change, and putting one field back.
//
// This is the editor-side half of the review surface. The comparison itself lives in
// backend/entry-diff (pure, tested there); this owns the STATE — when the diff is
// loaded, which field the reviewer has picked, and how a revert reaches the live
// editor without going through a save.
//
// A revert deliberately does NOT write to GitHub. It restores the value into the
// editor exactly as if the reviewer had typed the old text back, and leaves the entry
// dirty. Saving is still theirs to do, and the change is still theirs to abandon —
// which matters more once an agent is making the edits, because "undo what the robot
// did" must not itself be an irreversible act.
import { ref, shallowRef, computed } from "vue";
import type { GitHubClient } from "../backend/github";
import {
  loadEntryDiff,
  revertValue,
  changedPaths,
  BODY_FIELD,
  type EntryDiff,
  type FieldDiff,
} from "../backend/entry-diff";

export interface EntryReviewOptions {
  client: GitHubClient;
  /** Repo path of the entry, or null for one that has never been saved. */
  path: () => string | null;
  /** The editor's live frontmatter — mutated in place on revert (it is reactive). */
  data: Record<string, unknown>;
  /** The body as the editor currently holds it. */
  getBody: () => string;
  /** Put a reverted body back into the editor. */
  setBody: (html: string) => void;
  markDirty: () => void;
}

export function useEntryReview(options: EntryReviewOptions) {
  // shallowRef: the diff is a snapshot that is replaced wholesale, never edited in
  // place, and it holds the live values a revert reads from — making it deeply
  // reactive would cost a proxy over every field for no benefit.
  const diff = shallowRef<EntryDiff | null>(null);
  const loading = ref(false);
  const selected = ref<string | null>(null);

  const changed = computed(() => (diff.value ? changedPaths(diff.value) : []));
  const hasChanges = computed(() => changed.value.length > 0);

  /**
   * Load the comparison. Never throws and never reports an error: this is a review
   * aid layered on top of the editor, and an editor that refuses to open because it
   * could not reach the production branch would be a worse product than one that
   * simply cannot tell you what changed yet.
   */
  async function load(): Promise<void> {
    const path = options.path();
    if (!path) {
      // Nothing saved yet, so there is nothing on either branch to compare.
      diff.value = null;
      return;
    }
    loading.value = true;
    try {
      diff.value = await loadEntryDiff(options.client, path);
    } catch {
      diff.value = null;
    } finally {
      loading.value = false;
    }
  }

  function fieldAt(path: string): FieldDiff | null {
    return diff.value?.fields.find((f) => f.path === path) ?? null;
  }

  /**
   * Put one field back to what the live site has. Returns whether anything moved, so
   * a caller can avoid marking the entry dirty over a no-op.
   *
   * The frontmatter object is mutated IN PLACE rather than replaced: every field
   * widget in the editor is bound to that exact object, so swapping it would leave
   * the whole form bound to a detached copy.
   */
  function revert(path: string): boolean {
    const field = fieldAt(path);
    if (!field || field.status === "unchanged") return false;

    const next = revertValue(options.data, options.getBody(), field);

    if (path === BODY_FIELD) {
      options.setBody(next.body);
      options.markDirty();
      return true;
    }
    // Identity is preserved by revertValue on a no-op, which is the cheap test for
    // "the path has moved on since the diff was taken".
    if (next.data === options.data) return false;
    applyInto(options.data, next.data);
    options.markDirty();
    return true;
  }

  function select(path: string | null): void {
    selected.value = path;
  }

  return { diff, loading, changed, hasChanges, selected, load, revert, select };
}

/**
 * Copy `next` onto `target` in place, including REMOVALS — reverting an added field
 * means the key should no longer exist, and assigning `undefined` is not the same
 * thing: it survives into the YAML as an empty key rather than disappearing.
 *
 * Only the top level is walked. `revertValue` already returns fresh containers along
 * the path it touched, so assigning them wholesale is correct and a deep merge would
 * only risk resurrecting keys the revert deliberately dropped.
 */
function applyInto(target: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    if (!(key in next)) delete target[key];
  }
  for (const [key, value] of Object.entries(next)) {
    target[key] = value;
  }
}
