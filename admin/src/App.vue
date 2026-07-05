<script setup lang="ts">
import { computed, defineAsyncComponent, h, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
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
const BrandView = lazyPane(() => import("./ui/BrandView.vue"));
const PartsView = lazyPane(() => import("./ui/PartsView.vue"));
const ContentTypesView = lazyPane(() => import("./ui/ContentTypesView.vue"));
const PublishView = lazyPane(() => import("./ui/PublishView.vue"));
const OnboardingWizard = lazyPane(() => import("./ui/OnboardingWizard.vue"));
import { GitHubClient } from "./backend/github";
import type { Locale } from "./backend/config";
import { site, loadSiteConfig } from "./backend/site";
import { loadSchema } from "./backend/schema";
import { reportError } from "./errors";
import { confirmDiscard } from "./ui/dirty";
import {
  getCollection,
  folderCollections,
  entryFolder,
  COLLECTIONS,
  type FolderCollection,
  type FileEntry,
} from "./schema";
import { listRoute, localeSwapRoute } from "./router";

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
  | "brand"
  | "parts"
  | "blocks"
  | "contentTypes"
  | "publish";

const route = useRoute();
const router = useRouter();

// The token lives server-side (the /admin/api/gh proxy). Past Cloudflare Access
// the CMS just boots — no sign-in screen, no localStorage PAT.
const client = shallowRef(new GitHubClient());
const ready = ref(false);
const defaultCollection = () =>
  (getCollection("posts") ?? folderCollections()[0]) as FolderCollection;

// Ensure the working branch (staging) exists, then load the data-driven config +
// content model. Only after the model is loaded can routes resolve collections.
client.value
  .ensureWorkingBranch()
  .then(() => Promise.all([loadSiteConfig(client.value), loadSchema(client.value)]))
  .then(() => {
    // Booted at "/" → land on the default collection's list in the default locale.
    if (route.name === "home") {
      router.replace(listRoute(defaultCollection().name, site.defaultLocale));
    }
  })
  .catch((e) => reportError(e))
  .finally(() => {
    ready.value = true;
  });

// Every navigation guards on unsaved changes — one global guard replaces the
// per-action confirmDiscard() calls the manual nav functions used to make.
router.beforeEach(() => confirmDiscard());

// ── route → on-screen state ────────────────────────────────────────────────
// Settings panels that are their own pane (vs. the file-backed menu/redirects/seo).
const SPECIAL_PANELS: Record<string, Pane> = {
  parts: "parts",
  brand: "brand",
  themes: "themes",
  blocks: "blocks",
  contentTypes: "contentTypes",
  health: "health",
  languages: "languages",
};
function settingsFileByName(name: string): FileEntry | null {
  const fc = COLLECTIONS.find((c) => c.kind === "files");
  return fc && fc.kind === "files" ? (fc.files.find((f) => f.name === name) ?? null) : null;
}

const locale = computed<Locale>(() => (route.params.locale as string) || site.defaultLocale);
const routeCollection = computed<FolderCollection | undefined>(
  () => getCollection(route.params.collection as string) as FolderCollection | undefined,
);
// Always a real collection (falls back to the default) so the Sidebar/list never
// see `undefined`; non-collection routes just don't render the list.
const collection = computed<FolderCollection>(() => routeCollection.value ?? defaultCollection());
const settingsFile = computed<FileEntry | null>(() =>
  route.name === "settings" ? settingsFileByName(route.params.panel as string) : null,
);

const pane = computed<Pane>(() => {
  switch (route.name) {
    case "entry":
      return collection.value.body === "rich" ? "editRich" : "editRecord";
    case "settings": {
      const panel = route.params.panel as string;
      return SPECIAL_PANELS[panel] ?? (settingsFileByName(panel)?.view ?? "settings");
    }
    case "publish":
      return "publish";
    case "help":
      return "help";
    default:
      return "list";
  }
});

const editingPath = computed<string | null>(() => {
  if (route.name !== "entry") return null;
  const slug = route.params.slug as string;
  return slug === "new" ? null : `${entryFolder(collection.value, locale.value)}/${slug}.md`;
});

// ── navigation (push the URL; the beforeEach guard handles unsaved changes) ──
function selectCollection(name: string) {
  router.push(listRoute(name, locale.value));
}
function setLocale(l: Locale) {
  // Same screen, other language: swaps the :locale segment, so an open entry lands
  // on its translation (same slug) rather than dropping you to the list.
  router.push(localeSwapRoute(route, l));
}
function openSettings(file: FileEntry) {
  router.push(`/settings/${file.name}`);
}
function openPanel(panel: string) {
  router.push(`/settings/${panel}`);
}
function openPublish() {
  router.push("/publish");
}
function openHelp() {
  router.push("/help");
}
function backToList() {
  router.push(listRoute(collection.value.name, locale.value));
}

// Languages saved: if the active editing locale was just removed, fall back to the
// default. Return to the list either way.
function onLanguagesSaved() {
  const l = site.locales.some((x) => x.code === locale.value) ? locale.value : site.defaultLocale;
  router.push(listRoute(collection.value.name, l));
}

// Onboarding finished: config reloaded — land on the default collection list.
function onOnboarded() {
  router.push(listRoute(defaultCollection().name, site.defaultLocale));
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
      :brand-open="pane === 'brand'"
      :parts-open="pane === 'parts'"
      :blocks-open="pane === 'blocks'"
      :health-open="pane === 'health'"
      :content-types-open="pane === 'contentTypes'"
      :publish-open="pane === 'publish'"
      :locale="locale"
      :help-open="pane === 'help'"
      @select="selectCollection"
      @select-locale="setLocale"
      @open-settings="openSettings"
      @languages="openPanel('languages')"
      @themes="openPanel('themes')"
      @brand="openPanel('brand')"
      @parts="openPanel('parts')"
      @blocks="openPanel('blocks')"
      @health="openPanel('health')"
      @content-types="openPanel('contentTypes')"
      @publish="openPublish"
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
      <BrandView v-else-if="pane === 'brand'" :client="client" @back="backToList" />
      <PartsView v-else-if="pane === 'parts'" :client="client" @back="backToList" />
      <BlocksView v-else-if="pane === 'blocks'" :client="client" @back="backToList" />
      <LanguagesView
        v-else-if="pane === 'languages'"
        :client="client"
        @back="backToList"
        @saved="onLanguagesSaved"
      />
      <ContentTypesView
        v-else-if="pane === 'contentTypes'"
        :client="client"
        @back="backToList"
      />
      <PublishView
        v-else-if="pane === 'publish'"
        :client="client"
        @back="backToList"
      />
      <CollectionList
        v-else
        :key="`list#${collection.name}#${locale}`"
        :client="client"
        :collection="collection"
        :locale="locale"
      />
      </Transition>
    </main>
  </div>

  <ErrorDialog />
</template>
