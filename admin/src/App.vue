<script setup lang="ts">
import { defineAsyncComponent, h, ref, shallowRef } from "vue";
// Eager: the shell that's always on screen at boot.
import Sidebar from "./ui/Sidebar.vue";
import CollectionList from "./ui/CollectionList.vue";
import ErrorDialog from "./ui/ErrorDialog.vue";

// Lazy: every other pane is its own chunk, split out of the entry bundle. The
// big win is EditorView, which pulls the whole TipTap/ProseMirror stack; HelpView
// (marked), ThemesView (tar parsing) and the Cloudflare-backed views split too.
// A neutral full-height fallback (delay:0) fills the crossfade while the chunk
// loads, so a pane switch never leaves a blank gap — then the pane's own
// layout-stable skeleton takes over until its data arrives.
const PaneFallback = { render: () => h("div", { class: "min-h-screen" }) };
const lazyPane = (loader: () => Promise<unknown>) =>
  defineAsyncComponent({
    loader: loader as never,
    loadingComponent: PaneFallback,
    delay: 0,
    // A failed chunk fetch must never dead-end in a blank pane. Retry once
    // (transient blip), then surface it — the usual cause in dev is a stale
    // Vite optimizer under a tab that outlived a dev-server restart.
    onError(error, retry, fail, attempts) {
      if (attempts <= 1) return retry();
      reportError(
        new Error(
          `Couldn't load this screen (${error.message}). Reload the page — in dev, restart npm run dev.`,
        ),
      );
      fail();
    },
  });

const EditorView = lazyPane(() => import("./ui/EditorView.vue"));
const RecordEditor = lazyPane(() => import("./ui/RecordEditor.vue"));
const SettingsView = lazyPane(() => import("./ui/SettingsView.vue"));
const MenuView = lazyPane(() => import("./ui/MenuView.vue"));
const BlocksView = lazyPane(() => import("./ui/BlocksView.vue"));
const RedirectsView = lazyPane(() => import("./ui/RedirectsView.vue"));
const SiteHealthView = lazyPane(() => import("./ui/SiteHealthView.vue"));
const HelpView = lazyPane(() => import("./ui/HelpView.vue"));
const LanguagesView = lazyPane(() => import("./ui/LanguagesView.vue"));
const ThemesView = lazyPane(() => import("./ui/ThemesView.vue"));
const OnboardingWizard = lazyPane(() => import("./ui/OnboardingWizard.vue"));
import { GitHubClient } from "./backend/github";
import type { Locale } from "./backend/config";
import { site, loadSiteConfig } from "./backend/site";
import { reportError } from "./errors";
import { confirmDiscard } from "./ui/dirty";
import { getCollection, type FolderCollection, type FileEntry } from "./schema";

type Pane =
  | "list"
  | "editRich"
  | "editRecord"
  | "settings"
  | "menu"
  | "redirects"
  | "health"
  | "help"
  | "languages"
  | "themes"
  | "blocks";

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

// Every pane transition guards on unsaved changes: if the active editor is dirty,
// confirmDiscard() prompts and bails out when the user cancels.

function selectCollection(name: string) {
  if (!confirmDiscard()) return;
  collection.value = getCollection(name) as FolderCollection;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "list";
}

// Switching language drops back to the list so you never edit one locale's entry
// while the rail says another. The list re-fetches via its locale-keyed remount.
function setLocale(l: Locale) {
  if (!confirmDiscard()) return;
  locale.value = l;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "list";
}

function openSettings(file: FileEntry) {
  if (!confirmDiscard()) return;
  settingsFile.value = file;
  // A file entry can route to a purpose-built pane (Menu, Redirects) instead of
  // the generic form.
  pane.value = file.view ?? "settings";
}

function openHealth() {
  if (!confirmDiscard()) return;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "health";
}

function openHelp() {
  if (!confirmDiscard()) return;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "help";
}

function openLanguages() {
  if (!confirmDiscard()) return;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "languages";
}

function openThemes() {
  if (!confirmDiscard()) return;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "themes";
}

function openBlocks() {
  if (!confirmDiscard()) return;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "blocks";
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

// Shared "return to the list" handler for the editors' ← Back and the settings/
// help/themes/languages panes. Guards on unsaved changes like the rail nav does.
// The list remounts (its :key changes) and reloads on its own, so nothing to
// refresh here.
function backToList() {
  if (!confirmDiscard()) return;
  pane.value = "list";
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
    class="grid min-h-screen place-items-center text-sm text-zinc-500"
  >
    Loading…
  </div>

  <!-- First run (no site.json / not onboarded yet): the setup wizard. -->
  <OnboardingWizard v-else-if="!site.onboarded" :client="client" @done="onOnboarded" />

  <!-- The collection rail is permanent; only the main column swaps. -->
  <div v-else class="flex min-h-screen">
    <Sidebar
      :active-collection="collection.name"
      :active-settings="
        pane === 'settings' || pane === 'menu' || pane === 'redirects'
          ? (settingsFile?.name ?? null)
          : null
      "
      :languages-open="pane === 'languages'"
      :themes-open="pane === 'themes'"
      :blocks-open="pane === 'blocks'"
      :health-open="pane === 'health'"
      :locale="locale"
      :help-open="pane === 'help'"
      @select="selectCollection"
      @select-locale="setLocale"
      @open-settings="openSettings"
      @languages="openLanguages"
      @themes="openThemes"
      @blocks="openBlocks"
      @health="openHealth"
      @help="openHelp"
    />
    <main class="min-w-0 flex-1">
      <!-- Crossfade the main-column swap so switching panes doesn't hard-flash.
           Each branch below carries its own :key, so same-component switches
           (e.g. list → list) also fade. mode="out-in" avoids overlap. -->
      <Transition name="pane" mode="out-in">
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
        @back="backToList"
      />
      <MenuView
        v-else-if="pane === 'menu' && settingsFile"
        :key="`menu#${locale}`"
        :client="client"
        :file="settingsFile"
        :locale="locale"
        @back="backToList"
      />
      <RedirectsView
        v-else-if="pane === 'redirects'"
        :client="client"
        @back="backToList"
      />
      <SiteHealthView v-else-if="pane === 'health'" :client="client" @back="backToList" />
      <HelpView v-else-if="pane === 'help'" @back="backToList" />
      <ThemesView v-else-if="pane === 'themes'" :client="client" @back="backToList" />
      <BlocksView v-else-if="pane === 'blocks'" :client="client" @back="backToList" />
      <LanguagesView
        v-else-if="pane === 'languages'"
        :client="client"
        @back="backToList"
        @saved="onLanguagesSaved"
      />
      <CollectionList
        v-else
        :key="`list#${collection.name}#${locale}`"
        :client="client"
        :collection="collection"
        :locale="locale"
        @open="openEntry"
        @new="newEntry"
      />
      </Transition>
    </main>
  </div>

  <ErrorDialog />
</template>
