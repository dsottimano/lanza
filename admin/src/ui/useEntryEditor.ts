import { onMounted, reactive, ref } from "vue";
import type { GitHubClient } from "../backend/github";
import { entryFolder, type FolderCollection } from "../schema";
import type { Locale } from "../backend/config";
import { slugify } from "../backend/slug";
import { reportError } from "../errors";

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
}

export function useEntryEditor(props: EntryEditorProps, hooks: EntryEditorHooks) {
  const loading = ref(true);
  const data = reactive<Record<string, unknown>>({});
  let sha: string | undefined;
  let currentPath = props.path;
  let committed = false;

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

  async function save() {
    hooks.beforeSave?.();
    if (!currentPath) {
      const slug = slugify(String(data.title ?? ""));
      currentPath = `${entryFolder(props.collection, props.locale)}/${slug}.md`;
    }
    sha = await props.client.saveEntry(
      currentPath,
      { ...data },
      hooks.getBody(),
      `${sha ? "lanza: update" : "lanza: create"} ${currentPath}`,
      sha,
    );
    committed = true;
  }

  // `committed` is a plain flag read at "back"-emit time; expose a getter so the
  // template reads its current value without making it reactive.
  return { data, loading, save, wasCommitted: () => committed };
}
