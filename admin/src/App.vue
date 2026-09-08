<script setup lang="ts">
import { computed, defineAsyncComponent, h, ref, shallowRef, watch } from "vue";
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
const BlocksView = lazyPane(() => import("./ui/BlocksView.vue"));
const RedirectsView = lazyPane(() => import("./ui/RedirectsView.vue"));
const SiteHealthView = lazyPane(() => import("./ui/SiteHealthView.vue"));
const UpdatesView = lazyPane(() => import("./ui/UpdatesView.vue"));
const HelpView = lazyPane(() => import("./ui/HelpView.vue"));
const LanguagesView = lazyPane(() => import("./ui/LanguagesView.vue"));
// Header & footer (menu + preview + markup) and Brand & themes (brand + themes)
// are each one nav item now — the shells host the underlying editors together.
const HeaderFooterView = lazyPane(() => import("./ui/HeaderFooterView.vue"));
const BrandThemesView = lazyPane(() => import("./ui/BrandThemesView.vue"));
const ContentTypesView = lazyPane(() => import("./ui/ContentTypesView.vue"));
const PeopleView = lazyPane(() => import("./ui/PeopleView.vue"));
const AgentView = lazyPane(() => import("./ui/AgentView.vue"));
const PublishView = lazyPane(() => import("./ui/PublishView.vue"));
const PendingView = lazyPane(() => import("./ui/PendingView.vue"));
const OnboardingWizard = lazyPane(() => import("./ui/OnboardingWizard.vue"));
import { GitHubClient } from "./backend/github";
import type { Locale } from "./backend/config";
import { site, loadSiteConfig } from "./backend/site";
import { pendingCount, pendingCheckFailed } from "./backend/repository-state";
import { usePendingCount } from "./ui/usePendingCount";
import { liveOrigin, stagingOrigin, resolveStagingOrigin } from "./backend/site-urls";
import { loadSchema } from "./backend/schema";
import { refreshVersionState } from "./backend/version";
import { access, loadAccess } from "./backend/access";
import { reportError } from "./errors";
import { confirmDiscard } from "./ui/dirty";
import { focusMode } from "./ui/writing-preferences";
import {
  getCollection,
  folderCollections,
  entryFolder,
  COLLECTIONS,
  type FolderCollection,
  type FileEntry,
} from "./schema";
import { entryRoute, listRoute } from "./router";

type Pane =
  | "list"
  | "editRich"
  | "editRecord"
  | "settings"
  | "redirects"
  | "health"
  | "updates"
  | "help"
  | "languages"
  | "headerFooter"
  | "brandThemes"
  | "blocks"
  | "contentTypes"
  | "people"
  | "agent"
  | "publish"
  | "pending";

const route = useRoute();
const router = useRouter();
const settingsNavigationOpen = ref(false);
watch(() => route.fullPath, () => { settingsNavigationOpen.value = false; });

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
  .then(() =>
    Promise.all([
      loadSiteConfig(client.value),
      loadSchema(client.value),
      // Who is signed in and what they may do. Also never rejects: it fails to
      // "not an owner", so a hiccup hides owner-only controls rather than
      // offering them. The server enforces the same rule either way.
      loadAccess(client.value),
    ]),
  )
  .then(() => {
    // Booted at "/" → land on the default collection's list in the default locale.
    if (route.name === "home") {
      router.replace(listRoute(defaultCollection().name, site.defaultLocale));
    }
  })
  .catch((e) => reportError(e))
  .finally(() => {
    ready.value = true;
    void resolveStagingOrigin(client.value);
    // Advisory chrome for the sidebar's version line — deliberately NOT awaited,
    // so a slow or unreachable npm registry can never delay the CMS booting.
    void refreshVersionState(client.value);
  });

// Does this user get the owner's chrome? Publish, settings and hosting are hidden
// from an editor — and while access is still loading, so that the answer is never
// "yes" by default. This only decides what is OFFERED: the gh proxy re-checks every
// write against lanza.config.json regardless (functions/_lib/roles.ts).
const ownerView = computed(() => access.loaded && access.role === "owner");
const { retry: retryPending } = usePendingCount(client.value, ownerView);

// Every navigation guards on unsaved changes — one global guard replaces the
// per-action confirmDiscard() calls the manual nav functions used to make.
router.beforeEach(() => confirmDiscard());

// ── route → on-screen state ────────────────────────────────────────────────
// Settings panels that are their own pane (vs. the file-backed menu/redirects/seo).
const SPECIAL_PANELS: Record<string, Pane> = {
  "header-footer": "headerFooter",
  "brand-themes": "brandThemes",
  blocks: "blocks",
  contentTypes: "contentTypes",
  health: "health",
  updates: "updates",
  languages: "languages",
  people: "people",
  agent: "agent",
};
function settingsFileByName(name: string): FileEntry | null {
  const fc = COLLECTIONS.find((c) => c.kind === "files");
  return fc && fc.kind === "files" ? (fc.files.find((f) => f.name === name) ?? null) : null;
}

const locale = computed<Locale>(() => {
  const candidate = route.params.locale || (route.name === "settings" ? route.query.locale : undefined);
  return typeof candidate === "string" && site.locales.some(l => l.code === candidate)
    ? candidate : site.defaultLocale;
});
const routeCollection = computed<FolderCollection | undefined>(
  () => getCollection(route.params.collection as string) as FolderCollection | undefined,
);
// Always a real collection (falls back to the default) so the Sidebar/list never
// see `undefined`; non-collection routes just don't render the list.
const collection = computed<FolderCollection>(() => routeCollection.value ?? defaultCollection());
const settingsFile = computed<FileEntry | null>(() =>
  route.name === "settings" ? settingsFileByName(route.params.panel as string) : null,
);
// The Header & footer shell owns the menu file (its metadata drives the path).
const menuFile = computed<FileEntry | null>(() => settingsFileByName("menu"));

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
    case "pending":
      return "pending";
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

// A first save or explicit rename changes the address, not the editor session.
// Keep its Vue key while replacing the route so focus and undo history survive.
const savedEntry = ref<{ path: string; key: string } | null>(null);
const richEditorKey = computed(() => savedEntry.value?.path === editingPath.value
  ? savedEntry.value.key : `${collection.value.name}:${editingPath.value ?? 'new'}#${locale.value}`);
function onEntrySaved(path: string) {
  savedEntry.value = { path, key: richEditorKey.value };
  const slug = path.split("/").pop()!.replace(/\.md$/, "");
  router.replace(entryRoute(collection.value.name, locale.value, slug));
}

// ── navigation (push the URL; the beforeEach guard handles unsaved changes) ──
function selectCollection(name: string) {
  router.push(listRoute(name, locale.value));
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
function openPending() {
  router.push("/pending");
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
  <div v-else class="flex min-h-screen" :class="{ 'editing-shell': pane === 'editRich', 'theme-shell': pane === 'brandThemes', 'settings-shell': route.name === 'settings', 'settings-shell--nav-open': settingsNavigationOpen }">
    <button v-if="route.name === 'settings'" class="settings-mobile-navigation" :aria-expanded="settingsNavigationOpen" @click="settingsNavigationOpen = !settingsNavigationOpen">
      {{ settingsNavigationOpen ? 'Close navigation ×' : '☰ Site navigation' }}
    </button>
    <Sidebar
      v-show="!(pane === 'editRich' && focusMode)"
      :active-collection="collection.name"
      :active-settings="
        pane === 'settings' || pane === 'redirects'
          ? (settingsFile?.name ?? null)
          : null
      "
      :languages-open="pane === 'languages'"
      :header-footer-open="pane === 'headerFooter'"
      :brand-themes-open="pane === 'brandThemes'"
      :blocks-open="pane === 'blocks'"
      :health-open="pane === 'health'"
      :updates-open="pane === 'updates'"
      :content-types-open="pane === 'contentTypes'"
      :people-open="pane === 'people'"
      :agent-open="pane === 'agent'"
      :is-owner="ownerView"
      :pending-count="pendingCount"
      :pending-check-failed="pendingCheckFailed"
      @retry-pending="retryPending"
      :publish-open="pane === 'publish'"
      :pending-open="pane === 'pending'"
      :help-open="pane === 'help'"
      @select="selectCollection"
      @open-settings="openSettings"
      @languages="openPanel('languages')"
      @header-footer="openPanel('header-footer')"
      @brand-themes="openPanel('brand-themes')"
      @blocks="openPanel('blocks')"
      @health="openPanel('health')"
      @updates="openPanel('updates')"
      @content-types="openPanel('contentTypes')"
      @people="openPanel('people')"
      @agent="openPanel('agent')"
      @publish="openPublish"
      @pending="openPending"
      @help="openHelp"
    />
    <main class="min-w-0 flex-1">
      <div v-show="!(pane === 'editRich' && focusMode)" class="flex flex-wrap justify-end gap-4 border-b border-[var(--border)] px-5 py-2 text-xs text-zinc-600" aria-label="Site links">
        <a v-if="stagingOrigin" :href="stagingOrigin" target="_blank" rel="noopener noreferrer" title="Saved changes appear after the staging build finishes">View staging ↗</a>
        <a v-if="liveOrigin" :href="liveOrigin" target="_blank" rel="noopener noreferrer">View live site ↗</a>
      </div>
      <!-- Crossfade the main-column swap so switching panes doesn't hard-flash.
           Each branch below carries its own :key, so same-component switches
           (e.g. list → list) also fade. mode="out-in" avoids overlap. -->
      <Transition name="pane" mode="out-in">
      <EditorView
        v-if="pane === 'editRich'"
        :key="richEditorKey"
        :client="client"
        :collection="collection"
        :locale="locale"
        :path="editingPath"
        @back="backToList"
        @saved-path="onEntrySaved"
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
      <HeaderFooterView
        v-else-if="pane === 'headerFooter' && menuFile"
        :key="`header-footer#${locale}`"
        :client="client"
        :menu-file="menuFile"
        :locale="locale"
        @locale="(next: string) => router.push({ name: 'settings', params: { panel: 'header-footer' }, query: { ...route.query, locale: next } })"
        @back="backToList"
      />
      <BrandThemesView
        v-else-if="pane === 'brandThemes'"
        :client="client"
        @back="backToList"
      />
      <RedirectsView
        v-else-if="pane === 'redirects'"
        :client="client"
        @back="backToList"
      />
      <SiteHealthView v-else-if="pane === 'health'" :client="client" @back="backToList" />
      <UpdatesView v-else-if="pane === 'updates'" :client="client" @back="backToList" />
      <HelpView v-else-if="pane === 'help'" @back="backToList" />
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
      <PeopleView v-else-if="pane === 'people'" @back="backToList" />
      <AgentView v-else-if="pane === 'agent'" @back="backToList" />
      <PublishView
        v-else-if="pane === 'publish'"
        :client="client"
        @back="backToList"
      />
      <PendingView
        v-else-if="pane === 'pending'"
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
