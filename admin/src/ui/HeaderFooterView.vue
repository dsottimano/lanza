<script setup lang="ts">
// Settings → Header & footer: a VISUAL BUILDER for the site chrome. Each part
// (header/footer) is parsed into ordered SECTIONS (backend/parts-sections) shown as
// friendly cards — the menu loop becomes the link editor, the brand/switcher get
// labeled cards, and any other markup is an editable "HTML" block. Reorder, edit,
// remove, or add blocks; a LIVE PREVIEW renders the real header + footer beside them
// (same engine as the Astro build) so every change is visible before you save.
//
// Safety: parse partitions the source and serialize re-joins it verbatim, so a save
// can never corrupt a part (proven byte-for-byte in parts-sections.test.ts). The menu
// and switcher are data-backed (menu.json / the locale list), so editing them friendly-
// side never rewrites the HTML — only editing/reordering/adding blocks changes a part.
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import MenuEditor from "./MenuEditor.vue";
import HtmlPreview from "./HtmlPreview.vue";
import SaveButton from "./SaveButton.vue";
import { inputCls } from "../fields/styles";
import { GitHubClient, GitHubError } from "../backend/github";
import { PARTS, partPath, type PartName } from "../backend/parts";
import { fileEntryPath, type FileEntry } from "../schema";
import type { Locale } from "../backend/config";
import { site, localeLabel } from "../backend/site";
import { render } from "../../../frontend/lib/template-render";
import { normalizeMenu, serializeMenu, emptyMenu, type SiteMenu } from "../backend/menu";
import {
  parseSections,
  serializeSections,
  newRawSection,
  type Section,
} from "../backend/parts-sections";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient; menuFile: FileEntry; locale: Locale }>();
const emit = defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const activePart = ref<PartName>("header");

// ── menu model (per-locale, shared by both parts' menu cards) ───────────────
const menu = reactive<SiteMenu>(emptyMenu());
let menuSha: string | undefined;
const menuDirty = ref(false);
const menuPath = computed(() => fileEntryPath(props.menuFile, props.locale));

// ── part sections (header/footer markup — not localized) ────────────────────
const sections = reactive<Record<PartName, Section[]>>({ header: [], footer: [] });
const partSha = reactive<Record<PartName, string | undefined>>({ header: undefined, footer: undefined });
const partDirty = reactive<Record<PartName, boolean>>({ header: false, footer: false });

const activeSections = computed(() => sections[activePart.value]);

watch([menuDirty, () => partDirty.header, () => partDirty.footer], () => {
  isDirty.value = menuDirty.value || partDirty.header || partDirty.footer;
});
onUnmounted(() => (isDirty.value = false));

// ── load ─────────────────────────────────────────────────────────────────────
async function loadMenu() {
  try {
    const { data, sha } = await props.client.loadJson(menuPath.value);
    Object.assign(menu, normalizeMenu(data));
    menuSha = sha;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      Object.assign(menu, emptyMenu());
      menuSha = undefined;
    } else throw e;
  }
}
async function loadParts() {
  await Promise.all(
    PARTS.map(async (p) => {
      try {
        const f = await props.client.loadText(partPath(p.name));
        sections[p.name] = parseSections(f.text);
        partSha[p.name] = f.sha;
      } catch (e) {
        sections[p.name] = [];
        partSha[p.name] = undefined;
        if (!(e instanceof GitHubError && e.status === 404)) throw e;
      }
    }),
  );
}
async function load() {
  loading.value = true;
  try {
    await Promise.all([loadMenu(), loadParts()]);
    clearError();
  } catch (e) {
    reportError(e, "Failed to load the header & footer.");
  } finally {
    menuDirty.value = false;
    partDirty.header = false;
    partDirty.footer = false;
    loading.value = false;
    isDirty.value = false;
  }
}
watch(menuPath, load, { immediate: true }); // menu is per-locale → reload on language change

// ── live preview (both parts, real data) ─────────────────────────────────────
const partData = computed(() => ({
  homeUrl: "/",
  siteName: "Your site",
  year: new Date().getFullYear(),
  headerClass: "site-header",
  footerClass: "site-footer",
  menuHeader: menu.header.desktop,
  menuFooter: menu.footer.desktop,
  showSwitcher: site.locales.length > 1,
  locales: site.locales.map((l, i) => ({
    code: l.code.toUpperCase(),
    url: "#",
    active: i === 0,
    inactive: i !== 0, // engine has no {{else}} — pair active/inactive #ifs
    sep: i > 0,
  })),
}));
const previewBody = computed(() => {
  if (loading.value) return "";
  const header = render(serializeSections(sections.header), partData.value);
  const footer = render(serializeSections(sections.footer), partData.value);
  return `${header}<div style="min-height:40vh"></div>${footer}`;
});

// ── section operations (on the active part) ──────────────────────────────────
function markPartDirty() {
  partDirty[activePart.value] = true;
}
function move(i: number, delta: number) {
  const list = activeSections.value;
  const to = i + delta;
  if (to < 0 || to >= list.length) return;
  const [row] = list.splice(i, 1);
  list.splice(to, 0, row);
  markPartDirty();
}
function remove(i: number) {
  if (!confirm("Remove this block from the " + activePart.value + "?")) return;
  activeSections.value.splice(i, 1);
  markPartDirty();
}
function addBlock() {
  activeSections.value.push(newRawSection("<div>New block</div>"));
  markPartDirty();
}

// ── save (only changed parts + the menu) ──────────────────────────────────────
async function save() {
  if (menuDirty.value) {
    menuSha = await props.client.saveJson(
      menuPath.value,
      serializeMenu(menu),
      `lanza: update ${menuPath.value}`,
      menuSha,
    );
    menuDirty.value = false;
  }
  for (const p of PARTS) {
    if (!partDirty[p.name]) continue;
    partSha[p.name] = await props.client.saveText(
      partPath(p.name),
      serializeSections(sections[p.name]),
      `Edit ${p.name} part`,
      partSha[p.name],
    );
    partDirty[p.name] = false;
  }
  isDirty.value = false;
}

// Card presentation per section kind.
const META: Record<Section["kind"], { icon: string; label: string }> = {
  brand: { icon: "◆", label: "Brand / logo" },
  menu: { icon: "☰", label: "Menu links" },
  switcher: { icon: "🌐", label: "Language switcher" },
  raw: { icon: "</>", label: "HTML block" },
};
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm">
        <span v-if="isDirty" class="text-zinc-500">Unsaved changes</span>
      </span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-6xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">
        Header &amp; footer
        <span v-if="menuFile.localized" class="ml-2 align-middle text-base font-medium text-zinc-500">
          · {{ localeLabel(locale) }}
        </span>
      </h1>
      <p class="mb-6 text-sm text-zinc-600">
        Build the chrome that wraps every page. Edit the blocks on the left; the real
        header &amp; footer update on the right.
      </p>

      <div v-if="loading" class="card space-y-4 p-5">
        <div class="skeleton h-9 w-full" />
        <div class="skeleton h-9 w-2/3" />
      </div>

      <div v-else class="grid items-start gap-6 lg:grid-cols-2">
        <!-- Builder column -->
        <div>
          <!-- Which part to edit -->
          <div class="segment mb-4">
            <button
              v-for="p in PARTS"
              :key="p.name"
              class="segment-btn text-sm"
              :class="{ 'segment-btn--active': activePart === p.name }"
              @click="activePart = p.name"
            >
              {{ p.label }}
            </button>
          </div>

          <p v-if="!activeSections.length" class="card p-5 text-sm text-zinc-500">
            This part is empty. Add a block below.
          </p>

          <!-- Section cards, in document order -->
          <div class="flex flex-col gap-3">
            <div v-for="(s, i) in activeSections" :key="s.id" class="card p-4">
              <div class="mb-2 flex items-center gap-2">
                <span class="font-mono text-xs text-zinc-400">{{ META[s.kind].icon }}</span>
                <span class="text-sm font-semibold text-zinc-800">{{ META[s.kind].label }}</span>
                <span class="flex-1" />
                <button
                  class="grid size-7 place-items-center rounded-md text-zinc-400 transition hover:bg-[var(--surface)] hover:text-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
                  :disabled="i === 0"
                  title="Move up"
                  @click="move(i, -1)"
                >↑</button>
                <button
                  class="grid size-7 place-items-center rounded-md text-zinc-400 transition hover:bg-[var(--surface)] hover:text-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
                  :disabled="i === activeSections.length - 1"
                  title="Move down"
                  @click="move(i, 1)"
                >↓</button>
                <button
                  class="grid size-7 place-items-center rounded-md text-zinc-400 transition hover:bg-[var(--surface)] hover:text-red-600"
                  title="Remove"
                  @click="remove(i)"
                >✕</button>
              </div>

              <!-- Menu → the friendly link editor, locked to this part's location -->
              <MenuEditor
                v-if="s.kind === 'menu'"
                :model="menu"
                :location="s.location ?? activePart"
                @change="menuDirty = true"
              />

              <!-- Language switcher → derived, not hand-edited -->
              <p v-else-if="s.kind === 'switcher'" class="text-sm text-zinc-500">
                Shown automatically when you have more than one language
                (<span class="font-medium">Settings → Languages</span>). Remove this block to
                drop the switcher from the {{ activePart }}.
              </p>

              <!-- Brand + raw HTML → editable source -->
              <template v-else>
                <p v-if="s.kind === 'brand'" class="mb-2 text-xs text-zinc-500">
                  The logo/brand link. Edit its HTML here.
                </p>
                <textarea
                  v-model="s.source"
                  :rows="s.kind === 'brand' ? 8 : 5"
                  spellcheck="false"
                  :class="[inputCls, 'resize-y font-mono text-xs']"
                  @input="markPartDirty"
                />
              </template>
            </div>
          </div>

          <button class="btn btn-ghost mt-3 justify-center" @click="addBlock">+ Add HTML block</button>
        </div>

        <!-- Live preview -->
        <HtmlPreview :client="client" :body="previewBody" class="lg:sticky lg:top-3" />
      </div>
    </main>
  </div>
</template>
