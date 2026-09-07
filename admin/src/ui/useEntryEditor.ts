import { nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { GitHubError, type GitHubClient } from "../backend/github";
import { entryFolder, type FolderCollection } from "../schema";
import type { Locale } from "../backend/config";
import { access } from "../backend/access";
import { parseFrontmatter, serializeFrontmatter } from "../backend/frontmatter";
import { slugify } from "../backend/slug";
import { reportError } from "../errors";
import { isDirty } from "./dirty";

export interface EntryEditorProps {
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
  path: string | null;
}

export interface EntryEditorHooks {
  onLoaded?: (body: string, isNew: boolean) => void;
  getBody: () => string;
  beforeSave?: () => void;
  getSlug?: () => string;
  autosave?: boolean;
  getStorageSlug?: () => string;
  urlChanged?: () => boolean;
  saveEntry?: (path: string, data: Record<string, unknown>, body: string, sha?: string) => Promise<string>;
  onSaved?: (path: string) => void;
  restore?: (body: string, slug: string) => void;
}

interface Recovery {
  document: string;
  slug: string;
  sha?: string;
  path: string | null;
}

export function useEntryEditor(props: EntryEditorProps, hooks: EntryEditorHooks) {
  const loading = ref(true);
  const loadFailed = ref(false);
  const saving = ref(false);
  const saveError = ref("");
  const pauseReason = ref("");
  const savedAt = ref<Date | null>(null);
  const recovery = ref<Recovery | null>(null);
  const localCopy = ref(false);
  const currentPath = ref(props.path);
  const data = reactive<Record<string, unknown>>({});
  let sha: string | undefined;
  let pendingRemoval: { path: string; sha: string } | null = null;
  let revision = 0;
  let pauseRevision = 0;
  let active = true;
  let tracking = false;
  let preparing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<string> | undefined;
  // Session storage is tab-local: a second tab cannot replace this recovery copy.
  // Scope it to the signed-in user and repository, including on local dev origins.
  let recoveryKey = `lanza.draft.v1:${access.repo}:${access.login}:${props.path ?? `${props.collection.name}/${props.locale}/new`}`;

  function persist() {
    if (!hooks.restore || !tracking || recovery.value || !isDirty.value) return;
    try {
      const draft: Recovery = {
        document: serializeFrontmatter(data, hooks.getBody()),
        slug: hooks.getSlug?.() ?? "", sha, path: currentPath.value,
      };
      sessionStorage.setItem(recoveryKey, JSON.stringify(draft));
      localCopy.value = true;
    } catch { localCopy.value = false; }
  }

  function schedule() {
    clearTimeout(timer);
    if (!hooks.autosave || !active || recovery.value || pauseReason.value || saveError.value) return;
    timer = setTimeout(() => {
      if (!isDirty.value || saving.value || !String(data.title ?? "").trim()) return;
      // Renaming is still an explicit action, never a side effect of typing a URL.
      if (hooks.urlChanged?.()) {
        pauseAutosave("Save to confirm the URL change and its 301 redirect.");
        return;
      }
      const typed = (hooks.getStorageSlug ?? hooks.getSlug)?.().trim();
      if (currentPath.value && typed && slugify(typed) !== currentPath.value.split("/").pop()!.replace(/\.md$/, "")) {
        pauseAutosave("Save to confirm the URL change.");
        return;
      }
      void save().catch(() => { /* inline error persists until an explicit retry */ });
    }, 2000);
  }

  function markDirty() {
    if (!tracking || preparing || !active) return;
    revision++;
    isDirty.value = true;
    persist();
    schedule();
  }

  // Model changes include image replacements, removals, list edits and review
  // reverts. Native input/change events alone do not cover these operations.
  watch(data, markDirty, { deep: true, flush: "sync" });
  isDirty.value = false;
  onUnmounted(() => {
    persist();
    active = false;
    tracking = false;
    clearTimeout(timer);
    isDirty.value = false;
  });

  onMounted(async () => {
    try {
      if (props.path) {
        const entry = await props.client.loadEntry(props.path);
        if (!active) return;
        Object.assign(data, entry.data);
        sha = entry.sha;
        hooks.onLoaded?.(entry.body, false);
      } else {
        const defaults: Record<string, unknown> = {};
        for (const f of props.collection.fields) {
          if (f.default !== undefined) defaults[f.name] = f.default;
        }
        // Schema defaults are reactive too; detach arrays/objects without trying
        // to structuredClone Vue proxies or sharing mutable schema data.
        Object.assign(data, parseFrontmatter(serializeFrontmatter(defaults, "")).data);
        hooks.onLoaded?.("", true);
      }
      if (hooks.restore) {
        try {
          const raw = sessionStorage.getItem(recoveryKey);
          const draft = raw ? JSON.parse(raw) : null;
          if (draft && typeof draft.document === "string" && typeof draft.slug === "string" &&
              (draft.path === null || typeof draft.path === "string") &&
              (draft.sha === undefined || typeof draft.sha === "string")) recovery.value = draft;
        } catch { /* corrupt or unavailable storage does not block loading */ }
      }
    } catch (e) {
      loadFailed.value = true;
      reportError(e, "Failed to load entry.");
    } finally {
      loading.value = false;
      await nextTick();
      tracking = active && !loadFailed.value;
    }
  });

  function pauseAutosave(reason: string) {
    pauseRevision++;
    pauseReason.value = reason;
    clearTimeout(timer);
  }

  function discardRecovery() {
    recovery.value = null;
    try { sessionStorage.removeItem(recoveryKey); } catch { /* unavailable */ }
    localCopy.value = false;
  }

  function restoreRecovery() {
    const draft = recovery.value;
    if (!draft || !hooks.restore) return;
    // Retain the draft's base SHA. If an agent changed the stored file, GitHub
    // refuses the stale write instead of letting recovery overwrite the agent.
    tracking = false;
    const parsed = parseFrontmatter(draft.document);
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, parsed.data);
    hooks.restore(parsed.body, draft.slug);
    sha = draft.sha;
    currentPath.value = draft.path;
    recovery.value = null;
    tracking = true;
    pauseAutosave("Recovered writing. Review it, then save to continue autosaving.");
    markDirty();
  }

  function save(): Promise<string> {
    if (inFlight) return inFlight;
    clearTimeout(timer);
    inFlight = write().finally(() => {
      inFlight = undefined;
      saving.value = false;
      if (active && isDirty.value) schedule();
    });
    return inFlight;
  }

  async function write(): Promise<string> {
    if (loading.value || loadFailed.value || !active) throw new Error("The entry must load successfully before saving.");
    if (recovery.value) throw new Error("Restore or dismiss your recovered writing before saving.");
    if (!String(data.title ?? "").trim()) throw new Error("Give this entry a title before saving.");
    saving.value = true;
    saveError.value = "";
    try {
      if (pendingRemoval) {
        await props.client.deleteFile(pendingRemoval.path, pendingRemoval.sha, `lanza: remove ${pendingRemoval.path} (renamed)`);
        pendingRemoval = null;
      }
      preparing = true;
      try { hooks.beforeSave?.(); } finally { preparing = false; }
      const snapshotRevision = revision;
      const snapshotPauseRevision = pauseRevision;
      // YAML provides a detached snapshot and preserves Date values in frontmatter.
      const snapshot = parseFrontmatter(serializeFrontmatter(data, hooks.getBody()));
      const typed = ((hooks.getStorageSlug ?? hooks.getSlug)?.() ?? "").trim();
      const desiredSlug = slugify(typed || String(data.title));
      const oldPath = currentPath.value;
      const oldSha = sha;
      const dir = oldPath ? oldPath.slice(0, oldPath.lastIndexOf("/")) : entryFolder(props.collection, props.locale);
      const targetPath = `${dir}/${desiredSlug}.md`;
      const renaming = !!oldPath && targetPath !== oldPath;
      sha = hooks.saveEntry ? await hooks.saveEntry(targetPath, snapshot.data, snapshot.body, renaming ? undefined : sha) : await props.client.saveEntry(targetPath, snapshot.data, snapshot.body,
        `lanza: ${oldPath ? "update" : "create"} ${targetPath}`, renaming ? undefined : sha);
      currentPath.value = targetPath;
      const nextRecoveryKey = `lanza.draft.v1:${access.repo}:${access.login}:${targetPath}`;
      if (active && recoveryKey !== nextRecoveryKey) {
        try { sessionStorage.removeItem(recoveryKey); } catch { /* unavailable */ }
        recoveryKey = nextRecoveryKey;
      }
      if (renaming && oldPath && oldSha) {
        pendingRemoval = { path: oldPath, sha: oldSha };
        try {
          await props.client.deleteFile(oldPath, oldSha, `lanza: remove ${oldPath} (renamed)`);
          pendingRemoval = null;
        } catch {
          throw new Error("Your writing was saved at the new URL, but the old page could not be removed. Remove the old page before publishing.");
        }
      }
      if (active) {
        savedAt.value = new Date();
        if (pauseRevision === snapshotPauseRevision) pauseReason.value = "";
        if (revision === snapshotRevision) {
          isDirty.value = false;
          discardRecovery();
        } else persist();
        hooks.onSaved?.(targetPath);
      }
      return targetPath;
    } catch (e) {
      if (active) {
        saveError.value = e instanceof GitHubError && (e.status === 409 || e.status === 422)
          ? "This entry changed elsewhere. Your writing is still here. Reload to review the latest version before saving."
          : e instanceof Error ? e.message : "Saving failed. Please retry.";
        persist();
      }
      throw e;
    }
  }

  return { data, loading, loadFailed, saving, saveError, savedAt, pauseReason, recovery,
    localCopy, currentPath, save, dirty: isDirty, markDirty, pauseAutosave, restoreRecovery, discardRecovery };
}
