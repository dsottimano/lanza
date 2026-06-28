<script setup lang="ts">
// First-run onboarding. Three steps — logo, starter theme, languages — then
// writes everything to the repo through the proxy: the logo asset + appearance.json
// (theme/logo) + site.json (locale set + `onboarded: true`). Once onboarded is
// true the CMS skips this on future loads (see App.vue / backend/site.ts).
import { ref, computed } from "vue";
import { GitHubClient } from "../backend/github";
import { uploadImage } from "../backend/media";
import { site, loadSiteConfig, SITE_CONFIG_PATH, type LocaleDef } from "../backend/site";
import { reportError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "done"): void }>();

const APPEARANCE_PATH = "frontend/data/appearance.json";

// Starter themes — must match the [data-theme] blocks in frontend/styles/site.css.
// Swatches are representative (ink / paper / accent) for the picker.
const THEMES = [
  { id: "editorial", name: "Editorial", desc: "Clean serif — a classic blog", swatch: ["#18181b", "#fafafa", "#b91c1c"] },
  { id: "magazine", name: "Magazine", desc: "Bold, dense, editorial", swatch: ["#0a0a0a", "#f5f5f4", "#d97706"] },
  { id: "landing", name: "Landing", desc: "Marketing one-pager", swatch: ["#0f172a", "#ffffff", "#2563eb"] },
  { id: "classic", name: "Classic", desc: "Traditional and understated", swatch: ["#1c1917", "#fafaf9", "#15803d"] },
];

// Languages offered by the wizard. The chosen subset becomes site.json.locales.
const LANG_CATALOG: LocaleDef[] = [
  { code: "en", label: "English", ogLocale: "en_US" },
  { code: "es", label: "Español", ogLocale: "es_ES" },
  { code: "fr", label: "Français", ogLocale: "fr_FR" },
  { code: "de", label: "Deutsch", ogLocale: "de_DE" },
  { code: "it", label: "Italiano", ogLocale: "it_IT" },
  { code: "pt", label: "Português", ogLocale: "pt_PT" },
  { code: "nl", label: "Nederlands", ogLocale: "nl_NL" },
  { code: "ja", label: "日本語", ogLocale: "ja_JP" },
];

const step = ref(1);
const busy = ref(false);

// Step 1 — logo (optional)
const logoFile = ref<File | null>(null);
const logoPreview = ref("");
function onLogo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null;
  logoFile.value = file;
  logoPreview.value = file ? URL.createObjectURL(file) : "";
}

// Step 2 — theme
const theme = ref("editorial");

// Step 3 — languages
const multilingual = ref(false);
const single = ref("en");
const chosen = ref<string[]>(["en"]);
const defaultLocale = ref("en");

function toggleLang(code: string) {
  const i = chosen.value.indexOf(code);
  if (i === -1) chosen.value.push(code);
  else if (chosen.value.length > 1) chosen.value.splice(i, 1);
  if (!chosen.value.includes(defaultLocale.value)) defaultLocale.value = chosen.value[0];
}

const langValid = computed(() =>
  multilingual.value ? chosen.value.length >= 1 : !!single.value,
);

async function finish() {
  busy.value = true;
  try {
    // 1. Logo asset (optional) → its committed public path.
    let logoPath = "";
    if (logoFile.value) logoPath = await uploadImage(props.client, logoFile.value);

    // 2. appearance.json — merge onto whatever's there (preserve unknown keys).
    let apData: Record<string, unknown> = {};
    let apSha: string | undefined;
    try {
      const ap = await props.client.loadJson(APPEARANCE_PATH);
      apData = ap.data;
      apSha = ap.sha;
    } catch {
      /* no appearance.json yet — create it */
    }
    apData.theme = theme.value;
    if (logoPath) apData.logo = logoPath;
    await props.client.saveJson(APPEARANCE_PATH, apData, "lanza: onboarding — appearance", apSha);

    // 3. site.json — the chosen locale set + onboarded flag.
    const codes = multilingual.value ? chosen.value : [single.value];
    const def = multilingual.value ? defaultLocale.value : single.value;
    const locales = codes
      .map((c) => LANG_CATALOG.find((l) => l.code === c))
      .filter((l): l is LocaleDef => Boolean(l));
    await props.client.saveJson(
      SITE_CONFIG_PATH,
      { defaultLocale: def, locales, onboarded: true },
      "lanza: onboarding — site config",
      site.sha ?? undefined,
    );

    // 4. Refresh the in-memory config and hand off to the CMS.
    await loadSiteConfig(props.client);
    emit("done");
  } catch (e) {
    reportError(e);
  } finally {
    busy.value = false;
  }
}

const card = "rounded-xl border bg-white p-4 text-left transition";
</script>

<template>
  <div class="grid min-h-screen place-items-center bg-zinc-50 p-6">
    <div class="w-full max-w-xl">
      <div class="mb-6 text-center">
        <h1 class="font-serif text-3xl font-bold tracking-tight text-zinc-900">Welcome to Lanza</h1>
        <p class="mt-1 text-sm text-zinc-500">A few quick choices to set up your site.</p>
        <div class="mt-4 flex justify-center gap-1.5">
          <span
            v-for="n in 3"
            :key="n"
            :class="['h-1.5 w-8 rounded-full', n <= step ? 'bg-zinc-900' : 'bg-zinc-200']"
          />
        </div>
      </div>

      <div class="rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
        <!-- Step 1 — Logo -->
        <div v-if="step === 1">
          <h2 class="text-base font-semibold text-zinc-900">Add your logo</h2>
          <p class="mt-1 mb-5 text-sm text-zinc-500">
            Shown in the site header. Optional — you can skip and add one later.
          </p>
          <div class="flex items-center gap-4">
            <div class="grid size-20 place-items-center overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50">
              <img v-if="logoPreview" :src="logoPreview" alt="Logo preview" class="max-h-full max-w-full" />
              <span v-else class="text-xs text-zinc-400">No logo</span>
            </div>
            <label class="cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100">
              Choose image…
              <input type="file" accept="image/*" class="hidden" @change="onLogo" />
            </label>
          </div>
        </div>

        <!-- Step 2 — Theme -->
        <div v-else-if="step === 2">
          <h2 class="text-base font-semibold text-zinc-900">Pick a starter theme</h2>
          <p class="mt-1 mb-5 text-sm text-zinc-500">You can change this any time in Settings → Appearance.</p>
          <div class="grid grid-cols-2 gap-3">
            <button
              v-for="t in THEMES"
              :key="t.id"
              :class="[card, theme === t.id ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200 hover:border-zinc-300']"
              @click="theme = t.id"
            >
              <span class="mb-2 flex gap-1">
                <span
                  v-for="(c, i) in t.swatch"
                  :key="i"
                  class="size-5 rounded-full border border-black/5"
                  :style="{ backgroundColor: c }"
                />
              </span>
              <span class="block text-sm font-medium text-zinc-900">{{ t.name }}</span>
              <span class="block text-xs text-zinc-500">{{ t.desc }}</span>
            </button>
          </div>
        </div>

        <!-- Step 3 — Languages -->
        <div v-else>
          <h2 class="text-base font-semibold text-zinc-900">Languages</h2>
          <p class="mt-1 mb-5 text-sm text-zinc-500">Is this site in one language or several?</p>

          <div class="flex gap-2">
            <button
              :class="[card, 'flex-1 text-center', !multilingual ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200 hover:border-zinc-300']"
              @click="multilingual = false"
            >
              <span class="block text-sm font-medium text-zinc-900">One language</span>
            </button>
            <button
              :class="[card, 'flex-1 text-center', multilingual ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200 hover:border-zinc-300']"
              @click="multilingual = true"
            >
              <span class="block text-sm font-medium text-zinc-900">Multiple languages</span>
            </button>
          </div>

          <!-- Single -->
          <div v-if="!multilingual" class="mt-5">
            <label class="mb-1 block text-xs font-medium text-zinc-500">Language</label>
            <select v-model="single" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm">
              <option v-for="l in LANG_CATALOG" :key="l.code" :value="l.code">{{ l.label }}</option>
            </select>
          </div>

          <!-- Multiple -->
          <div v-else class="mt-5">
            <label class="mb-2 block text-xs font-medium text-zinc-500">Which languages?</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="l in LANG_CATALOG"
                :key="l.code"
                :class="['flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition', chosen.includes(l.code) ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300']"
                @click="toggleLang(l.code)"
              >
                <span :class="['grid size-4 place-items-center rounded border text-[10px]', chosen.includes(l.code) ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300']">
                  <span v-if="chosen.includes(l.code)">✓</span>
                </span>
                {{ l.label }}
              </button>
            </div>
            <label class="mt-4 mb-1 block text-xs font-medium text-zinc-500">Default language</label>
            <select v-model="defaultLocale" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm">
              <option v-for="c in chosen" :key="c" :value="c">
                {{ LANG_CATALOG.find((l) => l.code === c)?.label }}
              </option>
            </select>
          </div>
        </div>

        <!-- Nav -->
        <div class="mt-7 flex items-center justify-between">
          <button
            v-if="step > 1"
            class="rounded-lg px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100"
            :disabled="busy"
            @click="step--"
          >
            Back
          </button>
          <span v-else />

          <button
            v-if="step < 3"
            class="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700"
            @click="step++"
          >
            {{ step === 1 && !logoFile ? "Skip" : "Continue" }}
          </button>
          <button
            v-else
            class="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40"
            :disabled="busy || !langValid"
            @click="finish"
          >
            {{ busy ? "Setting up…" : "Finish setup" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
