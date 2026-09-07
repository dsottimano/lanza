<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
// Navigation is data-backed; layout remains one intact template. Recognition
// reveals available controls without treating unmatched wrapper tags as blocks.
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import MenuEditor from "./MenuEditor.vue";
import HtmlPreview from "./HtmlPreview.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient, GitHubError } from "../backend/github";
import { PARTS, partPath, type PartName } from "../backend/parts";
import { COLLECTIONS, fileEntryPath, type FileEntry } from "../schema";
import type { Locale } from "../backend/config";
import { site, localeLabel } from "../backend/site";
import { render } from "../../../frontend/lib/template-render";
import { normalizeMenu, serializeMenu, emptyMenu, type SiteMenu } from "../backend/menu";
import {
  parseSections,
  serializeSections,
  type Section,
} from "../backend/parts-sections";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient; menuFile: FileEntry; locale: Locale }>();
const emit = defineEmits<{ (e: "back"): void; (e: "locale", locale: string): void }>();

function selectLocale(event: Event) {
  const select = event.target as HTMLSelectElement;
  emit("locale", select.value);
  // The parent navigates through the unsaved-change guard. Keep the displayed
  // selection on the current language until navigation actually succeeds.
  select.value = props.locale;
}

const loading = ref(true);
const loadFailed = ref(false);
const previewSiteName = ref("Your site");
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
  loadFailed.value = false;
  try {
    await Promise.all([loadMenu(), loadParts(), loadPreviewName()]);
    clearError();
  } catch (e) {
    loadFailed.value = true;
    reportError(e, "Failed to load the header & footer.");
  } finally {
    menuDirty.value = false;
    partDirty.header = false;
    partDirty.footer = false;
    loading.value = false;
    isDirty.value = false;
  }
}
async function loadPreviewName() {
  previewSiteName.value = "Your site";
  const settings = COLLECTIONS.find(c => c.kind === "files");
  const seo = settings?.kind === "files" ? settings.files.find(f => f.name === "seo_defaults") : undefined;
  if (!seo) return;
  try {
    const { data } = await props.client.loadJson(fileEntryPath(seo, props.locale));
    const name = (data as { siteName?: unknown })?.siteName;
    if (typeof name === "string" && name.trim()) previewSiteName.value = name;
  } catch { /* Site name is advisory; unavailable SEO must not block navigation editing. */ }
}
watch(menuPath, load, { immediate: true }); // menu is per-locale → reload on language change

// ── live preview (both parts, real data) ─────────────────────────────────────
const partData = computed(() => ({
  homeUrl: props.locale === site.defaultLocale ? "/" : `/${props.locale}/`,
  siteName: previewSiteName.value,
  menuLabel: "Menu",
  primaryNavigationLabel: "Main navigation",
  year: new Date().getFullYear(),
  headerClass: "site-header",
  footerClass: "site-footer",
  menuHeader: menu.header.desktop,
  menuFooter: menu.footer.desktop,
  showSwitcher: site.locales.length > 1,
  locales: site.locales.map((l, i) => ({
    code: l.code.toUpperCase(),
    url: "#",
    active: l.code === props.locale,
    inactive: l.code !== props.locale,
    sep: i > 0,
  })),
}));
const previewBody = computed(() => {
  if (loading.value) return "";
  const header = render(serializeSections(sections.header), partData.value);
  const footer = render(serializeSections(sections.footer), partData.value);
  return `${header}<div style="min-height:240px;display:grid;place-items:center;margin:24px;border:1px dashed currentColor;opacity:.35;font:13px system-ui">Page content appears here</div>${footer}`;
});

// ── section operations (on the active part) ──────────────────────────────────
function markPartDirty() {
  partDirty[activePart.value] = true;
}
// Edit the complete template, preserving wrapper relationships and source order.
const templateSource = computed({
  get: () => serializeSections(activeSections.value),
  set: (source: string) => {
    sections[activePart.value] = parseSections(source);
    markPartDirty();
  },
});
const hasMenu = computed(() => activeSections.value.some(s => s.kind === "menu" && s.location === activePart.value));
const hasBrand = computed(() => activeSections.value.some(s => s.kind === "brand"));
const hasSwitcher = computed(() => activeSections.value.some(s => s.kind === "switcher"));

// ── save (only changed parts + the menu) ──────────────────────────────────────
async function save() {
  if (loading.value || loadFailed.value) return;
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

</script>

<template>
  <div class="settings-page">
    <SettingsHeader title="Header &amp; footer" @back="emit('back')">
      <template #actions>
      <span class="flex-1 text-center text-sm text-zinc-500" role="status">{{ loading ? 'Loading…' : loadFailed ? 'Couldn’t load' : isDirty ? 'Unsaved changes' : 'All changes saved' }}</span>
      <SaveButton :action="save" :disabled="loading || loadFailed || !isDirty" @saved="clearError" @error="(e) => reportError(e, 'Save failed.')" />
      </template>
      <template #description><p>Help visitors find their way. Manage the links that appear across your site.</p></template>
    </SettingsHeader>

    <main class="settings-body">
      <div class="hf-heading">
        <label v-if="menuFile.localized" class="text-xs text-zinc-500">
          Link language
          <select class="input mt-1" :value="locale" :disabled="loading" @change="selectLocale">
            <option v-for="language in site.locales" :key="language.code" :value="language.code">{{ localeLabel(language.code) }}</option>
          </select>
        </label>
      </div>

      <div v-if="loading" class="card space-y-4 p-5"><div class="skeleton h-9 w-full" /><div class="skeleton h-9 w-2/3" /></div>
      <div v-else-if="loadFailed" class="card p-6" role="alert">
        <p>We couldn’t load your header and footer. Try again to edit them.</p>
        <button class="btn btn-primary mt-3" @click="load">Try again</button>
      </div>
      <div v-else class="hf-layout">
        <div class="hf-controls">
          <div class="hf-part-picker" aria-label="Choose site area">
            <button v-for="p in PARTS" :key="p.name" :aria-pressed="activePart === p.name" :class="{ selected: activePart === p.name }" @click="activePart = p.name">
              <svg viewBox="0 0 36 28" fill="none" aria-hidden="true"><rect x="1" y="1" width="34" height="26" rx="2" stroke="currentColor" opacity=".4" /><rect x="4" :y="p.name === 'header' ? 4 : 18" width="28" height="6" rx="1" fill="currentColor" /></svg>
              <span><strong>{{ p.label }}</strong><small>{{ p.name === 'header' ? 'Top of every page' : 'Bottom of every page' }}</small></span>
            </button>
          </div>

          <section class="card hf-card">
            <div class="hf-card-heading">
              <h2>Navigation links</h2>
              <span class="hf-count">{{ menu[activePart].desktop.length }} links</span>
            </div>
            <p class="hf-description">{{ activePart === 'header' ? 'Keep your most useful destinations easy to reach.' : 'Add useful resources, contact links and legal pages.' }}</p>
            <p v-if="menuFile.localized" class="mb-4 text-xs text-zinc-500">Editing {{ localeLabel(locale) }} link text and destinations. Other languages keep their own links.</p>
            <MenuEditor v-if="hasMenu" :key="activePart" :model="menu" :location="activePart" @change="menuDirty = true" />
            <p v-else class="hf-note">This template doesn’t contain an editable navigation menu. Ask your agent to add one, or update the template below.</p>
          </section>

          <section v-if="hasBrand || hasSwitcher || activePart === 'footer'" class="card hf-card">
            <h2 class="mb-3">Also in your {{ activePart }}</h2>
            <div v-if="hasBrand" class="hf-detail"><span class="hf-detail-icon" aria-hidden="true">↗</span><div><h3>Brand / logo</h3><p>Your existing logo and home link are part of the design. Ask your agent to change the logo or its layout.</p></div></div>
            <div v-if="hasSwitcher" class="hf-detail"><span class="hf-detail-icon" aria-hidden="true">◎</span><div><h3>Language switcher</h3><p>{{ site.locales.length > 1 ? 'Visitors can switch between your site’s languages.' : 'Appears automatically when you add another site language.' }} Manage languages in Site settings.</p></div></div>
            <div v-if="activePart === 'footer'" class="hf-detail"><span class="hf-detail-icon" aria-hidden="true">©</span><div><h3>Footer design</h3><p>Copyright text, badges and layout come from your template. Ask your agent to adjust these, or use the template editor below.</p></div></div>
          </section>

          <details :key="activePart" class="hf-advanced">
            <summary>Advanced · Edit template</summary>
            <div class="pt-3">
              <p class="mb-3 text-xs text-zinc-500">The complete {{ activePart }} template, shared across languages. Changes affect every page. Keep the layout and template placeholders together.</p>
              <label class="block text-sm font-medium" :for="'source-' + activePart">{{ activePart === 'header' ? 'Header' : 'Footer' }} HTML</label>
              <textarea :id="'source-' + activePart" v-model="templateSource" rows="18" spellcheck="false" class="input mt-2 resize-y font-mono text-xs" />
            </div>
          </details>
        </div>

        <aside class="hf-preview">
          <div class="hf-preview-heading"><span>YOUR SITE</span><span>Header + footer</span></div>
          <HtmlPreview :client="client" :body="previewBody" />
          <p class="mt-3 text-xs text-zinc-500">Preview uses your current design and desktop links. Save to stage your changes; publish when you’re ready.</p>
        </aside>
      </div>
    </main>
  </div>
</template>

<style scoped>
.hf-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 28px; }
.hf-eyebrow { color: var(--muted); font-size: 10px; letter-spacing: .12em; font-weight: 600; margin-bottom: 8px; }
.hf-locale { border: 1px solid var(--border); padding: 6px 12px; border-radius: 20px; white-space: nowrap; font-size: 12px; color: var(--ink-soft); }
.hf-layout { display: grid; grid-template-columns: minmax(350px, .9fr) minmax(0, 1.3fr); gap: 32px; align-items: start; }
.hf-controls { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.hf-part-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.hf-part-picker button { display: flex; align-items: center; gap: 12px; padding: 14px; text-align: left; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); background: var(--paper-card); }
.hf-part-picker button.selected { border-color: var(--accent); color: var(--ink); background: #faf0e8; }
.hf-part-picker svg { width: 36px; flex-shrink: 0; }
.hf-part-picker strong { display: block; font-size: 14px; }
.hf-part-picker small { display: block; font-size: 11px; margin-top: 3px; color: var(--muted); }
.hf-part-picker button:focus-visible, .hf-advanced summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.hf-card { padding: 22px; border-radius: 6px; }
.hf-card h2 { font-weight: 600; font-size: 16px; }
.hf-card-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.hf-count { font-size: 11px; color: var(--muted); background: var(--paper); border-radius: 12px; padding: 3px 8px; }
.hf-description { font-size: 13px; color: var(--muted); margin: 6px 0 20px; line-height: 1.5; }
.hf-detail { display: flex; gap: 12px; padding: 12px 0; }
.hf-detail + .hf-detail { border-top: 1px solid var(--border); }
.hf-detail-icon { font-size: 20px; color: var(--muted); width: 24px; flex-shrink: 0; }
.hf-detail h3 { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
.hf-detail p, .hf-note { font-size: 12px; color: var(--muted); line-height: 1.6; }
.hf-advanced { border-top: 1px solid var(--border); padding: 16px 4px; }
.hf-advanced summary { font-size: 12px; color: var(--muted); cursor: pointer; }
.hf-preview { position: sticky; top: 80px; min-width: 0; }
.hf-preview-heading { display: flex; justify-content: space-between; font-size: 10px; letter-spacing: .08em; color: var(--muted); margin-bottom: 12px; }
.hf-preview :deep(.preview) { min-height: 460px; border-radius: 6px; }
@media (max-width: 1100px) { .hf-layout { grid-template-columns: 1fr; } .hf-preview { position: static; } }
@media (max-width: 600px) { .hf-heading { align-items: flex-start; flex-direction: column; } }
</style>
