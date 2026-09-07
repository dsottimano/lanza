<script setup lang="ts">
// Everyday work comes first; settings and administration can be tucked away.
// Reveal a section on navigation, while still allowing an explicit collapse.
import { computed, reactive, watch } from "vue";
import { COLLECTIONS, type FolderCollection, type FileEntry } from "../schema";
import { versionState, updateAvailable, securityUpdateRequired } from "../backend/version";
import { access } from "../backend/access";
import SidebarIcon from "./SidebarIcon.vue";

// The running version sits in the footer permanently: "what am I on" should never
// require hunting for a panel. It turns into a prompt only when there's something
// to do about it.
const runningVersion = computed(
  () => versionState.value?.staged ?? versionState.value?.live ?? null,
);
const hasUpdate = computed(() => (versionState.value ? updateAvailable(versionState.value) : false));
const insecure = computed(() =>
  versionState.value ? securityUpdateRequired(versionState.value) : false,
);

const props = defineProps<{
  activeCollection: string;
  activeSettings: string | null;
  languagesOpen: boolean;
  headerFooterOpen: boolean;
  brandThemesOpen: boolean;
  blocksOpen: boolean;
  healthOpen: boolean;
  updatesOpen: boolean;
  contentTypesOpen: boolean;
  peopleOpen: boolean;
  agentOpen: boolean;
  // Owner chrome. Publish, settings and hosting are structurally absent for an
  // editor rather than disabled — a greyed-out control that will never enable is
  // just a question the UI refuses to answer. Defaults to false so the rail is
  // never briefly permissive while access is still loading.
  isOwner: boolean;
  publishOpen: boolean;
  pendingOpen: boolean;
  helpOpen: boolean;
}>();
const emit = defineEmits<{
  (e: "select", name: string): void;
  (e: "openSettings", file: FileEntry): void;
  (e: "languages"): void;
  (e: "headerFooter"): void;
  (e: "brandThemes"): void;
  (e: "blocks"): void;
  (e: "health"): void;
  (e: "updates"): void;
  (e: "contentTypes"): void;
  (e: "people"): void;
  (e: "agent"): void;
  (e: "publish"): void;
  (e: "pending"): void;
  (e: "help"): void;
}>();

const folders = COLLECTIONS.filter(
  (c): c is FolderCollection => c.kind === "folder",
);
const content = folders.filter((c) => c.body === "rich");
const taxonomies = folders.filter((c) => c.body === "none");
const settings = COLLECTIONS.find((c) => c.kind === "files");
const settingsFiles = settings && settings.kind === "files" ? settings.files : [];
// The appearance + menu files are folded into the merged Appearance / Header &
// footer panes, so they're not listed on their own; the rest keep their own item.
const seoFile = settingsFiles.find((f) => f.name === "seo_defaults");
const redirectsFile = settingsFiles.find((f) => f.name === "redirects");

// ── Collapsible group state ──────────────────────────────────────────────
type GroupId = "content" | "taxonomies" | "design" | "structure" | "site";
// Bumped from ".groups": the stored value keyed the old single "settings" group,
// and merging that over the new defaults would leave the three replacements at
// their defaults anyway while carrying a key nothing reads. A new key retires it.
const STORAGE_KEY = "lanza.sidebar.groups.v2";
const DEFAULT_OPEN: Record<GroupId, boolean> = {
  content: true,
  taxonomies: true,
  design: true,
  structure: false,
  site: false,
};

function loadOpen(): Record<GroupId, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_OPEN, ...JSON.parse(raw) };
  } catch {
    /* private mode / corrupt value — fall back to defaults */
  }
  return { ...DEFAULT_OPEN };
}
const open = reactive(loadOpen());
watch(
  open,
  (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      /* storage unavailable — persistence is best-effort */
    }
  },
  { deep: true },
);

// Which group holds the current pane. Settings covers every settings-ish pane
// (Languages/Blocks/Themes/Site health + the settings/menu/redirects files).
const contentNames = new Set(content.map((c) => c.name));
const taxonomyNames = new Set(taxonomies.map((c) => c.name));
const designActive = computed(
  () => props.brandThemesOpen || props.headerFooterOpen || props.blocksOpen,
);
const structureActive = computed(
  () => props.contentTypesOpen || props.languagesOpen || props.activeSettings !== null,
);
const siteActive = computed(
  () => props.peopleOpen || props.agentOpen || props.healthOpen || props.updatesOpen,
);
const activeGroup = computed<GroupId | null>(() => {
  if (props.publishOpen || props.pendingOpen || props.helpOpen) return null;
  if (designActive.value) return "design";
  if (structureActive.value) return "structure";
  if (siteActive.value) return "site";
  if (contentNames.has(props.activeCollection)) return "content";
  if (taxonomyNames.has(props.activeCollection)) return "taxonomies";
  return null;
});

// Reveal the destination when navigating between sections. Collapsed sections
// are inert in the template so hidden controls cannot receive keyboard focus.
const isOpen = (id: GroupId) => open[id];
watch(activeGroup, (id) => {
  if (id) open[id] = true;
}, { immediate: true });
const toggle = (id: GroupId) => {
  open[id] = !open[id];
};

const groupLabel = "text-[0.68rem] font-semibold uppercase tracking-wider";
const item = "nav-item block";
const itemActive = "nav-item--active";
</script>

<template>
  <nav aria-label="Main navigation" class="sidebar rail-glass sticky top-3 m-3 flex h-[calc(100dvh-1.5rem)] w-60 flex-shrink-0 flex-col gap-3 rounded-3xl px-3 py-4">
    <div class="sidebar-brand flex-shrink-0 px-2.5 pt-1">
      <span class="font-serif text-xl font-bold tracking-tight text-zinc-900">Lanza</span>
      <!-- Same badge the public site carries. Someone editing their live site
           should be told what stage the software is at, in the software. -->
      <span
        class="ml-1.5 rounded-full border border-[var(--border)] px-1.5 py-0.5 align-middle font-mono text-[0.55rem] uppercase tracking-[0.18em] text-zinc-500"
      >beta</span>
    </div>

    <!-- Scroll region: the groups. The brand above and Guide below stay pinned;
         this is the only part that scrolls when content overflows. -->
    <div class="rail-scroll -mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
      <!-- Content -->
      <div class="rail-group">
        <button
          class="group-toggle"
          :class="groupLabel"
          :aria-expanded="isOpen('content')"
          @click="toggle('content')"
        >
          <span>Content</span>
          <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('content') }" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="group-body" :inert="!isOpen('content')" :class="{ 'group-body--open': isOpen('content') }">
          <div class="group-body__inner flex flex-col gap-0.5">
            <button
              v-for="c in content"
              :key="c.name"
              :class="[item, activeGroup === 'content' && activeCollection === c.name ? itemActive : '']"
              :aria-current="activeGroup === 'content' && activeCollection === c.name ? 'page' : undefined"
              @click="emit('select', c.name)"
            >
              <SidebarIcon :name="c.name" />{{ c.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Taxonomies -->
      <div class="rail-group">
        <button
          class="group-toggle"
          :class="groupLabel"
          :aria-expanded="isOpen('taxonomies')"
          @click="toggle('taxonomies')"
        >
          <span>Organize content</span>
          <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('taxonomies') }" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="group-body" :inert="!isOpen('taxonomies')" :class="{ 'group-body--open': isOpen('taxonomies') }">
          <div class="group-body__inner flex flex-col gap-0.5">
            <button
              v-for="c in taxonomies"
              :key="c.name"
              :class="[item, activeGroup === 'taxonomies' && activeCollection === c.name ? itemActive : '']"
              :aria-current="activeGroup === 'taxonomies' && activeCollection === c.name ? 'page' : undefined"
              @click="emit('select', c.name)"
            >
              <SidebarIcon :name="c.name" />{{ c.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Settings — owner only, and split three ways.
           It was one flat list of nine unrelated items: content types next to
           software updates next to redirects. Nine siblings is not a menu, it is
           a drawer. These three answer different questions — how the site LOOKS,
           how it is ORGANISED, and how it is RUN — so they are three groups. -->
      <template v-if="isOwner">
        <div class="rail-group">
          <button
            class="group-toggle"
            :class="groupLabel"
            :aria-expanded="isOpen('design')"
            @click="toggle('design')"
          >
            <span>Appearance</span>
            <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('design') }" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="group-body" :inert="!isOpen('design')" :class="{ 'group-body--open': isOpen('design') }">
            <div class="group-body__inner flex flex-col gap-0.5">
              <button :class="[item, brandThemesOpen ? itemActive : '']" :aria-current="brandThemesOpen ? 'page' : undefined" @click="emit('brandThemes')">
                <SidebarIcon name="appearance" />Brand &amp; themes
              </button>
              <button :class="[item, headerFooterOpen ? itemActive : '']" :aria-current="headerFooterOpen ? 'page' : undefined" @click="emit('headerFooter')">
                <SidebarIcon name="layout" />Header &amp; footer
              </button>
              <button :class="[item, blocksOpen ? itemActive : '']" :aria-current="blocksOpen ? 'page' : undefined" @click="emit('blocks')">
                <SidebarIcon name="blocks" />Saved snippets
              </button>
            </div>
          </div>
        </div>

        <div class="rail-group">
          <button
            class="group-toggle"
            :class="groupLabel"
            :aria-expanded="isOpen('structure')"
            @click="toggle('structure')"
          >
            <span>Site settings</span>
            <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('structure') }" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="group-body" :inert="!isOpen('structure')" :class="{ 'group-body--open': isOpen('structure') }">
            <div class="group-body__inner flex flex-col gap-0.5">
              <button :class="[item, contentTypesOpen ? itemActive : '']" :aria-current="contentTypesOpen ? 'page' : undefined" @click="emit('contentTypes')">
                <SidebarIcon name="blocks" />Content types
              </button>
              <button :class="[item, languagesOpen ? itemActive : '']" :aria-current="languagesOpen ? 'page' : undefined" @click="emit('languages')">
                <SidebarIcon name="languages" />Languages
              </button>
              <button
                v-if="seoFile"
                :class="[item, activeSettings === seoFile.name ? itemActive : '']"
                @click="emit('openSettings', seoFile)"
              >
                <SidebarIcon name="search" />{{ seoFile.label }}
              </button>
              <button
                v-if="redirectsFile"
                :class="[item, activeSettings === redirectsFile.name ? itemActive : '']"
                @click="emit('openSettings', redirectsFile)"
              >
                <SidebarIcon name="redirects" />{{ redirectsFile.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="rail-group">
          <button
            class="group-toggle"
            :class="groupLabel"
            :aria-expanded="isOpen('site')"
            @click="toggle('site')"
          >
            <span>Administration</span>
            <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('site') }" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="group-body" :inert="!isOpen('site')" :class="{ 'group-body--open': isOpen('site') }">
            <div class="group-body__inner flex flex-col gap-0.5">
              <button :class="[item, peopleOpen ? itemActive : '']" :aria-current="peopleOpen ? 'page' : undefined" @click="emit('people')">
                <SidebarIcon name="authors" />People &amp; access
              </button>
              <button v-if="isOwner" :class="[item, agentOpen ? itemActive : '']" :aria-current="agentOpen ? 'page' : undefined" @click="emit('agent')">
                <SidebarIcon name="agent" />Connect an agent
              </button>
              <button :class="[item, healthOpen ? itemActive : '']" :aria-current="healthOpen ? 'page' : undefined" @click="emit('health')">
                <SidebarIcon name="health" />Site health
              </button>
              <button :class="[item, updatesOpen ? itemActive : '']" :aria-current="updatesOpen ? 'page' : undefined" @click="emit('updates')">
                <SidebarIcon name="updates" />Software updates
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="sidebar-footer flex-shrink-0 border-t border-[var(--border)] pt-2 flex flex-col gap-0.5">
      <!-- Sits directly above Publish because it is the step before it: see what
           would go out, then send it. Owner-only for the same reason Publish is. -->
      <button
        v-if="isOwner"
        class="nav-item flex items-center gap-1.5"
        :class="{ 'nav-item--active': pendingOpen }"
        :aria-current="pendingOpen ? 'page' : undefined"
        @click="emit('pending')"
      >
        <SidebarIcon name="pending" />Review changes
      </button>
      <button
        v-if="isOwner"
        class="nav-item sidebar-publish flex items-center gap-1.5"
        :class="{ 'nav-item--active': publishOpen }"
        :aria-current="publishOpen ? 'page' : undefined"
        @click="emit('publish')"
      >
        <SidebarIcon name="publish" />Review &amp; publish
        <span class="ml-auto" aria-hidden="true">↗</span>
      </button>
      <button
        class="nav-item flex items-center gap-1.5"
        :class="{ 'nav-item--active': helpOpen }"
        :aria-current="helpOpen ? 'page' : undefined"
        @click="emit('help')"
      >
        <SidebarIcon name="help" />Help &amp; guide
      </button>

      <!-- Signing out is a plain link, not a fetch: the endpoint answers with a
           302 and three expired cookies, and letting the browser follow it is what
           makes the cookies actually land. It also has to be reachable when the
           SPA's own calls are failing, which is exactly when someone wants it. -->
      <a
        v-if="access.login"
        class="nav-item flex items-center gap-1.5"
        href="/admin/api/auth/logout"
      >
        <SidebarIcon name="logout" />Sign out
        <span class="ml-auto truncate text-xs text-zinc-500">{{ access.login }}</span>
      </a>

      <button
        v-if="runningVersion && isOwner"
        class="mt-1 flex items-center gap-1.5 px-2 py-1 text-left text-xs text-zinc-500 transition hover:text-zinc-900"
        @click="emit('updates')"
      >
        <span class="font-mono">v{{ runningVersion }}</span>
        <span
          v-if="insecure"
          class="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800"
        >
          Security update
        </span>
        <span
          v-else-if="hasUpdate"
          class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
        >
          Update available
        </span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 248px;
  gap: 18px;
}
.sidebar-brand {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.sidebar .rail-group + .rail-group {
  margin-top: 18px;
}
.sidebar .group-toggle {
  min-height: 30px;
  margin-bottom: 4px;
  font-size: 11px;
  letter-spacing: 0.06em;
}
.sidebar .nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  line-height: 1.35;
  border-radius: 5px;
  text-decoration: none;
}
.sidebar :deep(.sidebar-icon) {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  opacity: 0.75;
}
.sidebar .nav-item--active {
  background: #f6e8de;
  color: #923617;
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--accent);
}
.sidebar .nav-item--active :deep(.sidebar-icon) {
  opacity: 1;
}
.sidebar-footer {
  gap: 4px;
  padding-top: 12px;
}
.sidebar .sidebar-publish {
  margin-bottom: 8px;
  background: var(--ink);
  color: var(--paper-card);
  font-weight: 500;
}
.sidebar .sidebar-publish:hover {
  background: var(--ink-soft);
}
.sidebar .sidebar-publish.nav-item--active {
  box-shadow: inset 3px 0 0 var(--accent);
}
@media (max-height: 740px) {
  .sidebar { gap: 10px; }
  .sidebar-brand { padding-bottom: 8px; }
  .sidebar .rail-group + .rail-group { margin-top: 10px; }
}
</style>
