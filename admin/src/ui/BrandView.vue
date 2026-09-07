<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
// Settings → Brand. Restyle the PUBLIC site's palette, corner style, motion, and
// fonts — a live preview on the right, one Save that commits the `brand` block
// to appearance.json (staging) and triggers a Pages rebuild. No CSS is touched;
// the render side (frontend/lib/appearance.ts) turns the block into inline
// custom-property overrides that beat the active theme's tokens.
import { reactive, ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { GitHubClient } from "../backend/github";
import {
  loadAppearance,
  saveBrand,
  defaultBrand,
  previewFontHref,
  COLOR_TOKENS,
  RADIUS_OPTIONS,
  SCHEME_OPTIONS,
  FONT_CATALOG,
  FONT_IDS,
  PRESETS,
  type BrandConfig,
  type BrandColors,
  type BrandPreset,
} from "../backend/brand";
import SaveButton from "./SaveButton.vue";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient }>();
defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const savedOnce = ref(false);
const brand = reactive<BrandConfig>(defaultBrand());
let baseline = "";

const snapshot = () => JSON.stringify(brand);
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

onMounted(async () => {
  try {
    const a = await loadAppearance(props.client);
    Object.assign(brand, a.brand);
    baseline = snapshot();
  } catch (e) {
    reportError(e, "Couldn't load the current appearance.");
  } finally {
    loading.value = false;
  }
});

// Dirty tracking drives App.vue's leave-guard + the tab-close warning.
watch(
  brand,
  () => {
    isDirty.value = snapshot() !== baseline;
    if (isDirty.value) savedOnce.value = false;
  },
  { deep: true },
);
onBeforeUnmount(() => {
  isDirty.value = false;
});

function setColor(key: keyof BrandColors, value: string) {
  if (HEX.test(value)) brand.colors[key] = value;
}

// Field-by-field on purpose: a preset (and "reset to defaults") restyles the
// palette/corners/motion/fonts and leaves everything else — today, `scheme` —
// standing. Never assign the whole object, or applying a palette would quietly
// drop a pinned light/dark choice on the next save.
function applyPreset(p: BrandPreset) {
  brand.colors = { ...p.colors };
  brand.radius = p.radius;
  brand.motion = p.motion;
  brand.fonts = { ...p.fonts };
}

function resetToDefaults() {
  applyPreset(defaultBrand());
}

async function save() {
  await saveBrand(props.client, JSON.parse(JSON.stringify(brand)) as BrandConfig);
  baseline = snapshot();
  isDirty.value = false;
  savedOnce.value = true;
}

// ── live preview ──────────────────────────────────────────────────────────
// Load the chosen webfonts into the admin doc so the preview is truthful; one
// managed <link>, updated as the selection changes, removed on unmount.
const FONT_LINK_ID = "lanza-brand-preview-fonts";
watch(
  () => previewFontHref(brand.fonts),
  (href) => {
    let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
    if (!href) {
      link?.remove();
      return;
    }
    if (!link) {
      link = document.createElement("link");
      link.id = FONT_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = href;
  },
  { immediate: true },
);
onBeforeUnmount(() => document.getElementById(FONT_LINK_ID)?.remove());

const previewStyle = computed(
  () =>
    ({
      "--bg": brand.colors.bg,
      "--surface": brand.colors.surface,
      "--ink": brand.colors.ink,
      "--muted": brand.colors.muted,
      "--accent": brand.colors.accent,
      "--border": brand.colors.border,
      "--radius": brand.radius,
      "--font-heading": FONT_CATALOG[brand.fonts.heading]?.stack,
      "--font-body": FONT_CATALOG[brand.fonts.body]?.stack,
    }) as Record<string, string>,
);

const fontOptions = FONT_IDS.map((id) => ({ id, label: FONT_CATALOG[id].label }));
</script>

<template>
  <div class="settings-page">
    <SettingsHeader title="Brand &amp; themes" @back="$emit('back')">
      <template #actions>
        <SaveButton
          :action="save"
          :disabled="loading"
          @saved="clearError"
          @error="(e) => reportError(e, 'Saving your brand failed — nothing was committed.')"
        />
      </template>
      <template #description><p>Shape the look of your site. Preview changes as you go.</p></template>
      <template #navigation><slot name="navigation" /></template>
    </SettingsHeader>

    <main class="settings-body settings-body--wide">
      <div
        v-if="savedOnce"
        class="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        ✓ Brand saved to staging. Preview your changes, then publish when ready.
      </div>
      <div v-if="loading" class="text-sm text-zinc-500">Loading appearance…</div>

      <div v-else class="brand-workspace">
        <!-- ── controls ─────────────────────────────────────────────────── -->
        <div class="brand-controls">
          <!-- Presets -->
          <section class="brand-section">
            <h2 class="mb-1 text-sm font-semibold text-zinc-900">Palettes</h2>
            <p class="mb-3 text-xs text-zinc-500">Start from a preset, then fine-tune below.</p>
            <div class="brand-palettes">
              <button
                v-for="p in PRESETS"
                :key="p.name"
                class="brand-palette"
                :aria-pressed="JSON.stringify(brand.colors) === JSON.stringify(p.brand.colors) && brand.radius === p.brand.radius && brand.motion === p.brand.motion && brand.fonts.heading === p.brand.fonts.heading && brand.fonts.body === p.brand.fonts.body"
                @click="applyPreset(p.brand)"
              >
                <span class="flex -space-x-1">
                  <span
                    v-for="k in (['bg', 'accent', 'ink'] as (keyof BrandColors)[])"
                    :key="k"
                    class="size-4 rounded-full ring-1 ring-black/10"
                    :style="{ background: p.brand.colors[k] }"
                  />
                </span>
                {{ p.name }}
              </button>
            </div>
          </section>

          <!-- Colors -->
          <section class="brand-section">
            <h2 class="mb-3 text-sm font-semibold text-zinc-900">Colors</h2>
            <div class="grid gap-4">
              <label v-for="t in COLOR_TOKENS" :key="t.key" class="flex items-center gap-3">
                <input
                  type="color"
                  class="size-9 flex-shrink-0 cursor-pointer rounded-lg border border-zinc-200 bg-transparent p-0.5"
                  :aria-label="`${t.label} color`"
                  :value="brand.colors[t.key]"
                  @input="setColor(t.key, ($event.target as HTMLInputElement).value)"
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-xs font-medium text-zinc-800">{{ t.label }}</span>
                  <span class="block truncate text-[0.68rem] text-zinc-400">{{ t.hint }}</span>
                </span>
                <input
                  type="text"
                  class="w-[5.5rem] rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs text-zinc-700 focus:border-zinc-400 focus:outline-none"
                  :aria-label="`${t.label} hex value`"
                  :value="brand.colors[t.key]"
                  spellcheck="false"
                  @change="setColor(t.key, ($event.target as HTMLInputElement).value.trim())"
                />
              </label>
            </div>
          </section>

          <!-- Fonts -->
          <section class="brand-section grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-sm font-semibold text-zinc-900">Heading font</span>
              <select
                v-model="brand.fonts.heading"
                class="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 focus:border-zinc-400 focus:outline-none"
              >
                <option v-for="f in fontOptions" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-sm font-semibold text-zinc-900">Body font</span>
              <select
                v-model="brand.fonts.body"
                class="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 focus:border-zinc-400 focus:outline-none"
              >
                <option v-for="f in fontOptions" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </label>
          </section>
          <!-- Corners + Motion + Color scheme -->
          <details class="brand-section brand-details">
            <summary>Finishing touches <span>Corners, motion &amp; color scheme</span></summary>
            <div class="grid gap-5 pt-5">
            <div>
              <h2 class="mb-2 text-sm font-semibold text-zinc-900">Corners</h2>
              <div class="segment">
                <button
                  v-for="r in RADIUS_OPTIONS"
                  :key="r.value"
                  class="segment-btn"
                  :class="{ 'segment-btn--active': brand.radius === r.value }"
                  @click="brand.radius = r.value"
                >
                  {{ r.label }}
                </button>
              </div>
            </div>
            <div>
              <h2 class="mb-2 text-sm font-semibold text-zinc-900">Motion</h2>
              <div class="segment">
                <button
                  class="segment-btn"
                  :class="{ 'segment-btn--active': brand.motion === 'off' }"
                  @click="brand.motion = 'off'"
                >
                  None
                </button>
                <button
                  class="segment-btn"
                  :class="{ 'segment-btn--active': brand.motion === 'on' }"
                  @click="brand.motion = 'on'"
                >
                  Subtle
                </button>
              </div>
              <p class="mt-2 text-[0.68rem] text-zinc-400">Hover/press feedback on buttons, nav, and cards.</p>
            </div>
            <div>
              <h2 class="mb-2 text-sm font-semibold text-zinc-900">Color scheme</h2>
              <div class="segment">
                <button
                  v-for="s in SCHEME_OPTIONS"
                  :key="s.value"
                  class="segment-btn"
                  :class="{ 'segment-btn--active': brand.scheme === s.value }"
                  @click="brand.scheme = s.value"
                >
                  {{ s.label }}
                </button>
              </div>
              <p class="mt-2 text-[0.68rem] text-zinc-400">
                Auto follows each visitor's device setting. Light or Dark pins the site to one.
              </p>
            </div>
            </div>
          </details>

          <button class="brand-reset" @click="resetToDefaults">Reset to Lanza defaults</button>
        </div>

        <!-- ── live preview ─────────────────────────────────────────────── -->
        <div class="brand-preview-stage">
          <p class="mb-2 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">Live preview <span class="normal-case font-normal tracking-normal"> · Sample page</span></p>
          <div class="brand-preview" :style="previewStyle" :data-motion="brand.motion">
            <div class="pv-header">
              <span class="pv-brand">Lanza ↗</span>
              <nav class="pv-nav"><a>Work</a><a>About</a><a>Journal</a></nav>
            </div>
            <div class="pv-body">
              <h2 class="pv-h1">A quiet, confident brand.</h2>
              <p class="pv-meta">Journal · 4 min read</p>
              <p class="pv-p">
                A space for your ideas, your work, and what comes next. Share <a class="pv-link">something meaningful</a> and make <mark class="pv-mark">a little room</mark> for discovery.
              </p>
              <a class="pv-btn">Read more →</a>
              <div class="pv-card">Good things begin with a simple idea. Give yours a place to grow.</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Self-contained mini-site. Reads the same custom properties Base.astro sets on
   <html>, so it tracks every control instantly. Not the public site.css — a
   faithful-enough proxy of header / heading / prose / button / card. */
.brand-preview {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-body);
  min-height: 32rem;
}
.pv-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
}
.pv-brand {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--ink);
}
.pv-nav {
  display: flex;
  gap: 0.7rem;
}
.pv-nav a {
  font-size: 0.66rem;
  letter-spacing: 0.04em;
  color: var(--muted);
  cursor: pointer;
}
.pv-body {
  padding: clamp(1.5rem, 4vw, 3rem);
}
.pv-h1 {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: clamp(2rem, 3.3vw, 3.5rem);
  line-height: 1.12;
  letter-spacing: -0.01em;
  margin: 0 0 1rem;
  color: var(--ink);
}
.pv-meta {
  color: var(--muted);
  font-size: 0.72rem;
  margin: 0 0 0.7rem;
}
.pv-p {
  font-size: 0.86rem;
  line-height: 1.6;
  margin: 0 0 0.9rem;
}
.pv-link {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.pv-mark {
  background: color-mix(in srgb, var(--accent) 26%, transparent);
  color: inherit;
  padding: 0.05em 0.15em;
  border-radius: 3px;
}
.pv-btn {
  display: inline-block;
  padding: 0.5rem 1rem;
  background: var(--accent);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 600;
  border-radius: var(--radius);
  cursor: pointer;
}
.pv-card {
  margin-top: 2.5rem;
  padding: 0.8rem 0.9rem;
  background: var(--surface);
  border-radius: var(--radius);
  font-size: 0.76rem;
  color: var(--muted);
}

@media (max-width: 600px) {
  .brand-preview { min-height: 0; }
  .pv-body { padding: 1.5rem; }
  .pv-h1 { font-size: 2rem; }
}

/* Motion mirrors the public [data-motion="on"] block. */
.brand-preview[data-motion="on"] .pv-btn,
.brand-preview[data-motion="on"] .pv-nav a,
.brand-preview[data-motion="on"] .pv-card {
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.15s ease;
}
.brand-preview[data-motion="on"] .pv-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px -8px color-mix(in srgb, var(--accent) 55%, transparent);
}
.brand-preview[data-motion="on"] .pv-nav a:hover {
  opacity: 0.6;
}
.brand-preview[data-motion="on"] .pv-card:hover {
  transform: translateY(-3px);
}
@media (prefers-reduced-motion: reduce) {
  .brand-preview[data-motion="on"] * {
    transition: none;
  }
}
</style>
