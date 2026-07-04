<script setup lang="ts">
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
  FONT_CATALOG,
  FONT_IDS,
  PRESETS,
  type BrandConfig,
  type BrandColors,
} from "../backend/brand";
import SaveButton from "./SaveButton.vue";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

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

function applyPreset(p: BrandConfig) {
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
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="text-sm font-semibold text-zinc-900">Brand</span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="clearError"
        @error="(e) => reportError(e, 'Saving your brand failed — nothing was committed.')"
      />
    </header>

    <main class="mx-auto max-w-5xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Brand</h1>
      <p class="mb-6 max-w-2xl text-sm text-zinc-600">
        Set your site's colors, corners, motion, and fonts — Brand owns the whole
        look. Saving commits to your repo and rebuilds the site — it goes live in a
        minute or two. <button class="underline underline-offset-2 hover:text-zinc-900" @click="resetToDefaults">Reset to Lanza defaults</button>.
      </p>

      <div
        v-if="savedOnce"
        class="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        ✓ Brand saved. Cloudflare Pages is rebuilding — your site updates in ~1–2 minutes.
      </div>

      <div v-if="loading" class="text-sm text-zinc-500">Loading appearance…</div>

      <div v-else class="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <!-- ── controls ─────────────────────────────────────────────────── -->
        <div class="flex flex-col gap-6">
          <!-- Presets -->
          <section class="card p-5">
            <h2 class="mb-1 text-sm font-semibold text-zinc-900">Palettes</h2>
            <p class="mb-3 text-xs text-zinc-500">Start from a preset, then fine-tune below.</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="p in PRESETS"
                :key="p.name"
                class="group flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 py-1.5 pl-1.5 pr-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400"
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
          <section class="card p-5">
            <h2 class="mb-3 text-sm font-semibold text-zinc-900">Colors</h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <label v-for="t in COLOR_TOKENS" :key="t.key" class="flex items-center gap-3">
                <input
                  type="color"
                  class="size-9 flex-shrink-0 cursor-pointer rounded-lg border border-zinc-200 bg-transparent p-0.5"
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
                  :value="brand.colors[t.key]"
                  spellcheck="false"
                  @change="setColor(t.key, ($event.target as HTMLInputElement).value.trim())"
                />
              </label>
            </div>
          </section>

          <!-- Corners + Motion -->
          <section class="card grid gap-5 p-5 sm:grid-cols-2">
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
          </section>

          <!-- Fonts -->
          <section class="card grid gap-4 p-5 sm:grid-cols-2">
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
        </div>

        <!-- ── live preview ─────────────────────────────────────────────── -->
        <div class="lg:sticky lg:top-6 lg:self-start">
          <p class="mb-2 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">Preview</p>
          <div class="brand-preview" :style="previewStyle" :data-motion="brand.motion">
            <div class="pv-header">
              <span class="pv-brand">Lanza ↗</span>
              <nav class="pv-nav"><a>Work</a><a>About</a><a>Journal</a></nav>
            </div>
            <div class="pv-body">
              <h1 class="pv-h1">A quiet, confident brand</h1>
              <p class="pv-meta">March 2026 · 4 min read</p>
              <p class="pv-p">
                Body copy set in your chosen face. A <a class="pv-link">link</a> tracks the
                accent, and <mark class="pv-mark">a highlight</mark> washes it back.
              </p>
              <a class="pv-btn">Read more →</a>
              <div class="pv-card">Surface — cards, code, callouts and CTAs sit here.</div>
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
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-body);
  box-shadow: 0 12px 30px -18px rgba(0, 0, 0, 0.35);
}
.pv-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
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
  padding: 1.1rem 1rem 1.3rem;
}
.pv-h1 {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 1.5rem;
  line-height: 1.12;
  letter-spacing: -0.01em;
  margin: 0 0 0.35rem;
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
  margin-top: 1rem;
  padding: 0.8rem 0.9rem;
  background: var(--surface);
  border-radius: var(--radius);
  font-size: 0.76rem;
  color: var(--muted);
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
