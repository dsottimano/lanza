<script setup lang="ts">
import { ref, shallowRef, useTemplateRef } from "vue";
import Sidebar from "./ui/Sidebar.vue";
import CollectionList from "./ui/CollectionList.vue";
import EditorView from "./ui/EditorView.vue";
import RecordEditor from "./ui/RecordEditor.vue";
import SettingsView from "./ui/SettingsView.vue";
import HelpView from "./ui/HelpView.vue";
import LanguagesView from "./ui/LanguagesView.vue";
import OnboardingWizard from "./ui/OnboardingWizard.vue";
import ErrorDialog from "./ui/ErrorDialog.vue";
import { GitHubClient } from "./backend/github";
import type { Locale } from "./backend/config";
import { site, loadSiteConfig } from "./backend/site";
import { reportError } from "./errors";
import { getCollection, type FolderCollection, type FileEntry } from "./schema";

type Pane = "list" | "editRich" | "editRecord" | "settings" | "help" | "languages";

// The token lives server-side (the /admin/api/gh proxy). Past Cloudflare Access
// the CMS just boots — no sign-in screen, no localStorage PAT. The client carries
// no token; the proxy injects it.
const client = shallowRef(new GitHubClient());
// Load the data-driven site config (locales) from the repo before rendering, so
// the language rail and default locale reflect frontend/data/site.json.
const ready = ref(false);
loadSiteConfig(client.value)
  .then(() => {
    locale.value = site.defaultLocale;
  })
  .catch((e) => reportError(e))
  .finally(() => {
    ready.value = true;
  });

const pane = ref<Pane>("list");
// Active editing language. Scopes localized collections (posts/pages/taxonomies)
// to their per-locale subfolder; shared collections (authors) ignore it.
const locale = ref<Locale>("en");
const collection = shallowRef<FolderCollection>(getCollection("posts") as FolderCollection);
const editingPath = ref<string | null>(null);
const settingsFile = shallowRef<FileEntry | null>(null);
const listRef = useTemplateRef<InstanceType<typeof CollectionList>>("listRef");

function selectCollection(name: string) {
  collection.value = getCollection(name) as FolderCollection;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "list";
}

// Switching language drops back to the list so you never edit one locale's entry
// while the rail says another. The list re-fetches via its locale-keyed remount.
function setLocale(l: Locale) {
  locale.value = l;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "list";
}

function openSettings(file: FileEntry) {
  settingsFile.value = file;
  pane.value = "settings";
}

function openHelp() {
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "help";
}

function openLanguages() {
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "languages";
}

// Languages saved: the config store is already refreshed. If the active editing
// locale was just removed, fall back to the default. Return to the list.
function onLanguagesSaved() {
  if (!site.locales.some((l) => l.code === locale.value)) {
    locale.value = site.defaultLocale;
  }
  pane.value = "list";
}

function openEntry(path: string) {
  editingPath.value = path;
  pane.value = collection.value.body === "rich" ? "editRich" : "editRecord";
}

function newEntry() {
  editingPath.value = null;
  pane.value = collection.value.body === "rich" ? "editRich" : "editRecord";
}

function backToList(changed: boolean) {
  pane.value = "list";
  if (changed) listRef.value?.reload();
}

// Onboarding just finished: config was reloaded, so adopt the new default locale
// and fall through to the CMS (site.onboarded is now true).
function onOnboarded() {
  locale.value = site.defaultLocale;
}
</script>

<template>
  <div
    v-if="!ready"
    class="grid min-h-screen place-items-center bg-zinc-50 text-sm text-zinc-400"
  >
    Loading…
  </div>

  <!-- First run (no site.json / not onboarded yet): the setup wizard. -->
  <OnboardingWizard v-else-if="!site.onboarded" :client="client" @done="onOnboarded" />

  <!-- The collection rail is permanent; only the main column swaps. -->
  <div v-else class="flex min-h-screen bg-zinc-50">
    <Sidebar
      :active-collection="collection.name"
      :active-settings="pane === 'settings' ? (settingsFile?.name ?? null) : null"
      :languages-open="pane === 'languages'"
      :locale="locale"
      :help-open="pane === 'help'"
      @select="selectCollection"
      @select-locale="setLocale"
      @open-settings="openSettings"
      @languages="openLanguages"
      @help="openHelp"
    />
    <main class="min-w-0 flex-1">
      <EditorView
        v-if="pane === 'editRich'"
        :key="`${editingPath ?? 'new'}#${locale}`"
        :client="client"
        :collection="collection"
        :locale="locale"
        :path="editingPath"
        @back="backToList"
      />
      <RecordEditor
        v-else-if="pane === 'editRecord'"
        :key="`${editingPath ?? 'new'}#${locale}`"
        :client="client"
        :collection="collection"
        :locale="locale"
        :path="editingPath"
        @back="backToList"
      />
      <SettingsView
        v-else-if="pane === 'settings' && settingsFile"
        :key="`${settingsFile.name}#${locale}`"
        :client="client"
        :file="settingsFile"
        :locale="locale"
        @back="pane = 'list'"
      />
      <HelpView v-else-if="pane === 'help'" @back="pane = 'list'" />
      <LanguagesView
        v-else-if="pane === 'languages'"
        :client="client"
        @back="pane = 'list'"
        @saved="onLanguagesSaved"
      />
      <CollectionList
        v-else
        ref="listRef"
        :key="`list#${collection.name}#${locale}`"
        :client="client"
        :collection="collection"
        :locale="locale"
        @open="openEntry"
        @new="newEntry"
      />
    </main>
  </div>

  <ErrorDialog />
</template>
