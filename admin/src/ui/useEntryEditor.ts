import { onMounted, onUnmounted, reactive, ref } from "vue";
import type { GitHubClient } from "../backend/github";
import { entryFolder, type FolderCollection } from "../schema";
import type { Locale } from "../backend/config";
import { slugify } from "../backend/slug";
import { reportError } from "../errors";
import { isDirty } from "./dirty";

// Shared load/save lifecycle for the two entry editors — the rich-body
// EditorView (posts/pages) and the form-only RecordEditor (categories/tags/
// authors). Both load an entry's frontmatter into a reactive `data`, seed
// schema defaults for a new entry, and commit via `saveEntry`, deriving the new
// entry's path from `entryFolder(...)/<slugified title>.md`. Each editor differs
// only in where the body comes from, which the seams below cover.

export interface EntryEditorProps {
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
  path: string | null;
}

export interface EntryEditorHooks {
  /** Fired after load with the raw body ("" for a new entry) and whether it's
   *  new — the caller prepares its own body state (HTML canvas vs kept string). */
  onLoaded?: (body: string, isNew: boolean) => void;
  /** The body to commit (live editor HTML, or the preserved string). */
  getBody: () => string;
  /** Optional `data` mutation just before save (e.g. posts' updatedDate). */
  beforeSave?: () => void;
  /** The desired slug (filename) for this entry. Empty → derive from the title.
   *  Changing it on an existing entry renames the file (see `save`). */
  getSlug?: () => string;
}

export function useEntryEditor(props: EntryEditorProps, hooks: EntryEditorHooks) {
  const loading = ref(true);
  const data = reactive<Record<string, unknown>>({});
  let sha: string | undefined;
  let currentPath = props.path;

  // Dirty tracking lives here so both entry editors share it. `isDirty` is the
  // app-wide flag App.vue guards navigation on; reset it whenever this editor
  // mounts/unmounts so a stale flag from a previous pane never lingers.
  const markDirty = () => (isDirty.value = true);
  isDirty.value = false;
  onUnmounted(() => (isDirty.value = false));

  onMounted(async () => {
    try {
      if (props.path) {
        const entry = await props.client.loadEntry(props.path);
        Object.assign(data, entry.data);
        sha = entry.sha;
        hooks.onLoaded?.(entry.body, false);
      } else {
        for (const f of props.collection.fields) {
          if (f.default !== undefined && data[f.name] === undefined) data[f.name] = f.default;
        }
        hooks.onLoaded?.("", true);
      }
    } catch (e) {
      reportError(e, "Failed to load entry.");
    } finally {
      loading.value = false;
    }
  });

  // Save, and return the entry's path (the caller uses it to keep the URL in sync
  // after a rename). The slug decides the filename: on a NEW entry it seeds the
  // path; on an EXISTING one, changing it renames the file — write the new path,
  // then delete the old (two staging commits; no public rebuild until publish).
  async function save(): Promise<string> {
    hooks.beforeSave?.();
    // Always slugify: whatever the user typed becomes a filename + a URL, so it must
    // be slug-safe (no spaces, no slashes escaping the collection folder). An empty
    // slug falls back to the title. (slugify never returns "", so guard on the input.)
    const typed = (hooks.getSlug?.() ?? "").trim();
    const desiredSlug = typed ? slugify(typed) : slugify(String(data.title ?? ""));

    let targetPath: string;
    if (currentPath) {
      // Keep the entry's own directory (home lives at the pages root, localized
      // entries in their per-locale subfolder) — only swap the basename.
      const dir = currentPath.slice(0, currentPath.lastIndexOf("/"));
      const oldSlug = currentPath.slice(dir.length + 1).replace(/\.md$/, "");
      targetPath = oldSlug === desiredSlug ? currentPath : `${dir}/${desiredSlug}.md`;
    } else {
      targetPath = `${entryFolder(props.collection, props.locale)}/${desiredSlug}.md`;
    }

    const renaming = !!currentPath && targetPath !== currentPath;
    const oldPath = currentPath;
    const oldSha = sha;

    // Renaming writes a NEW file (no sha), then removes the old one. Finalise the
    // editor's own state on the NEW file BEFORE the delete: if the delete then fails
    // (rare — a concurrent staging change), the new file is already the source of
    // truth and the error surfaces for a manual cleanup of the orphan, rather than
    // leaving the editor pointed at a file that no longer exists.
    sha = await props.client.saveEntry(
      targetPath,
      { ...data },
      hooks.getBody(),
      `${currentPath ? "lanza: update" : "lanza: create"} ${targetPath}`,
      renaming ? undefined : sha,
    );
    currentPath = targetPath;
    isDirty.value = false;
    if (renaming && oldPath && oldSha) {
      await props.client.deleteFile(oldPath, oldSha, `lanza: remove ${oldPath} (renamed)`);
    }
    return targetPath;
  }

  return { data, loading, save, dirty: isDirty, markDirty };
}
