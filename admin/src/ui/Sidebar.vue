<script setup lang="ts">
// Collection rail: content collections, taxonomies, then the settings files.
// Grouping is derived from the schema (folder vs files collection). Each group is
// collapsible (chevron on the label); Content + Taxonomies open by default,
// Settings collapsed. Open/closed state persists in localStorage, and a group is
// force-shown whenever it holds the active pane so the user is never stranded.
import { computed, reactive, watch } from "vue";
import { COLLECTIONS, type FolderCollection, type FileEntry } from "../schema";
import { versionState, updateAvailable, securityUpdateRequired } from "../backend/version";

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
  // Owner chrome. Publish, settings and hosting are structurally absent for an
  // editor rather than disabled — a greyed-out control that will never enable is
  // just a question the UI refuses to answer. Defaults to false so the rail is
  // never briefly permissive while access is still loading.
  isOwner: boolean;
  publishOpen: boolean;
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
  (e: "publish"): void;
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
  design: false,
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
  () => props.peopleOpen || props.healthOpen || props.updatesOpen,
);
const activeGroup = computed<GroupId | null>(() => {
  if (designActive.value) return "design";
  if (structureActive.value) return "structure";
  if (siteActive.value) return "site";
  if (contentNames.has(props.activeCollection)) return "content";
  if (taxonomyNames.has(props.activeCollection)) return "taxonomies";
  return null;
});

// Display state = the user's stored preference OR force-open when active, so
// auto-opening a group to reveal the active item never overwrites their choice.
const isOpen = (id: GroupId) => open[id] || activeGroup.value === id;
const toggle = (id: GroupId) => {
  open[id] = !open[id];
};

const groupLabel = "text-[0.68rem] font-semibold uppercase tracking-wider";
const item = "nav-item block";
const itemActive = "nav-item--active";
</script>

<template>
  <nav class="rail-glass sticky top-3 m-3 flex h-[calc(100vh-1.5rem)] w-60 flex-shrink-0 flex-col gap-3 rounded-3xl px-3 py-4">
    <div class="flex-shrink-0 px-2.5 pt-1">
      <span class="font-serif text-xl font-bold tracking-tight text-zinc-900">Lanza</span>
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
        <div class="group-body" :class="{ 'group-body--open': isOpen('content') }">
          <div class="group-body__inner flex flex-col gap-0.5">
            <button
              v-for="c in content"
              :key="c.name"
              :class="[item, activeCollection === c.name && !activeSettings ? itemActive : '']"
              @click="emit('select', c.name)"
            >
              {{ c.label }}
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
          <span>Taxonomies</span>
          <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('taxonomies') }" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="group-body" :class="{ 'group-body--open': isOpen('taxonomies') }">
          <div class="group-body__inner flex flex-col gap-0.5">
            <button
              v-for="c in taxonomies"
              :key="c.name"
              :class="[item, activeCollection === c.name && !activeSettings ? itemActive : '']"
              @click="emit('select', c.name)"
            >
              {{ c.label }}
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
            <span>Design</span>
            <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('design') }" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="group-body" :class="{ 'group-body--open': isOpen('design') }">
            <div class="group-body__inner flex flex-col gap-0.5">
              <button :class="[item, brandThemesOpen ? itemActive : '']" @click="emit('brandThemes')">
                Brand &amp; themes
              </button>
              <button :class="[item, headerFooterOpen ? itemActive : '']" @click="emit('headerFooter')">
                Header &amp; footer
              </button>
              <button :class="[item, blocksOpen ? itemActive : '']" @click="emit('blocks')">
                Blocks
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
            <span>Structure</span>
            <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('structure') }" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="group-body" :class="{ 'group-body--open': isOpen('structure') }">
            <div class="group-body__inner flex flex-col gap-0.5">
              <button :class="[item, contentTypesOpen ? itemActive : '']" @click="emit('contentTypes')">
                Content types
              </button>
              <button :class="[item, languagesOpen ? itemActive : '']" @click="emit('languages')">
                Languages
              </button>
              <button
                v-if="seoFile"
                :class="[item, activeSettings === seoFile.name ? itemActive : '']"
                @click="emit('openSettings', seoFile)"
              >
                {{ seoFile.label }}
              </button>
              <button
                v-if="redirectsFile"
                :class="[item, activeSettings === redirectsFile.name ? itemActive : '']"
                @click="emit('openSettings', redirectsFile)"
              >
                {{ redirectsFile.label }}
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
            <span>Site</span>
            <svg class="group-chevron" :class="{ 'group-chevron--open': isOpen('site') }" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="group-body" :class="{ 'group-body--open': isOpen('site') }">
            <div class="group-body__inner flex flex-col gap-0.5">
              <button :class="[item, peopleOpen ? itemActive : '']" @click="emit('people')">
                People
              </button>
              <button :class="[item, healthOpen ? itemActive : '']" @click="emit('health')">
                Site health
              </button>
              <button :class="[item, updatesOpen ? itemActive : '']" @click="emit('updates')">
                Software
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="flex-shrink-0 border-t border-[var(--border)] pt-2 flex flex-col gap-0.5">
      <button
        v-if="isOwner"
        class="nav-item flex items-center gap-1.5"
        :class="{ 'nav-item--active': publishOpen }"
        @click="emit('publish')"
      >
        <span aria-hidden="true">🚀</span> Publish
      </button>
      <button
        class="nav-item flex items-center gap-1.5"
        :class="{ 'nav-item--active': helpOpen }"
        @click="emit('help')"
      >
        <span aria-hidden="true">📖</span> Guide
      </button>

      <button
        v-if="runningVersion"
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
