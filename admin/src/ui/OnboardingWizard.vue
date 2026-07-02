<script setup lang="ts">
// First-run onboarding. Three steps — logo, starter theme, languages — then
// writes everything to the repo through the proxy: the logo asset + appearance.json
// (theme/logo) + site.json (locale set + `onboarded: true`). Once onboarded is
// true the CMS skips this on future loads (see App.vue / backend/site.ts).
import { ref, computed, onBeforeUnmount } from "vue";
import { GitHubClient } from "../backend/github";
import { uploadImage } from "../backend/media";
import { loadSiteConfig, SITE_CONFIG_PATH, putJsonSafe, LANG_CATALOG, type LocaleDef } from "../backend/site";
import LocalePicker from "./LocalePicker.vue";
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

const step = ref(1);
const busy = ref(false);

// Step 1 — logo (optional)
const logoFile = ref<File | null>(null);
const logoPreview = ref("");
function onLogo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null;
  logoFile.value = file;
  // Revoke the previous object URL before replacing it (and on unmount) so
  // re-picking a logo doesn't leak blobs.
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value);
  logoPreview.value = file ? URL.createObjectURL(file) : "";
}
onBeforeUnmount(() => {
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value);
});

// Step 2 — theme
const theme = ref("editorial");

// Step 3 — languages
const multilingual = ref(false);
const single = ref("en");
const chosen = ref<string[]>(["en"]);
const defaultLocale = ref("en");

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
    await putJsonSafe(
      props.client,
      APPEARANCE_PATH,
      (cur) => {
        const next: Record<string, unknown> = { ...cur, theme: theme.value };
        if (logoPath) next.logo = logoPath;
        return next;
      },
      "lanza: onboarding — appearance",
    );

    // 3. site.json — the chosen locale set + onboarded flag (preserve other keys).
    const codes = multilingual.value ? chosen.value : [single.value];
    const def = multilingual.value ? defaultLocale.value : single.value;
    const locales = codes
      .map((c) => LANG_CATALOG.find((l) => l.code === c))
      .filter((l): l is LocaleDef => Boolean(l));
    await putJsonSafe(
      props.client,
      SITE_CONFIG_PATH,
      (cur) => ({ ...cur, defaultLocale: def, locales, onboarded: true }),
      "lanza: onboarding — site config",
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

const card = "rounded-xl border bg-white/50 p-4 text-left transition";
</script>

<template>
  <div class="grid min-h-screen place-items-center p-6">
    <div class="w-full max-w-xl">
      <div class="mb-6 text-center">
        <h1 class="font-serif text-3xl font-bold tracking-tight text-zinc-900">Welcome to Lanza</h1>
        <p class="mt-1 text-sm text-zinc-600">A few quick choices to set up your site.</p>
        <div class="mt-4 flex justify-center gap-1.5">
          <span
            v-for="n in 3"
            :key="n"
            :class="['h-1.5 w-8 rounded-full', n <= step ? 'bg-zinc-900' : 'bg-zinc-200']"
          />
        </div>
      </div>

      <div class="card p-7">
        <!-- Step 1 — Logo -->
        <div v-if="step === 1">
          <h2 class="text-base font-semibold text-zinc-900">Add your logo</h2>
          <p class="mt-1 mb-5 text-sm text-zinc-500">
            Shown in the site header. Optional — you can skip and add one later.
          </p>
          <div class="flex items-center gap-4">
            <div class="grid size-20 place-items-center overflow-hidden rounded-xl border border-dashed border-white/60 bg-white/40">
              <img v-if="logoPreview" :src="logoPreview" alt="Logo preview" class="max-h-full max-w-full" />
              <span v-else class="text-xs text-zinc-500">No logo</span>
            </div>
            <label class="btn btn-ghost cursor-pointer">
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
              :class="[card, theme === t.id ? 'border-zinc-900 ring-4 ring-zinc-900/10' : 'border-white/50 hover:border-white/80']"
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
              :class="[card, 'flex-1 text-center', !multilingual ? 'border-zinc-900 ring-4 ring-zinc-900/10' : 'border-white/50 hover:border-white/80']"
              @click="multilingual = false"
            >
              <span class="block text-sm font-medium text-zinc-900">One language</span>
            </button>
            <button
              :class="[card, 'flex-1 text-center', multilingual ? 'border-zinc-900 ring-4 ring-zinc-900/10' : 'border-white/50 hover:border-white/80']"
              @click="multilingual = true"
            >
              <span class="block text-sm font-medium text-zinc-900">Multiple languages</span>
            </button>
          </div>

          <!-- Single -->
          <div v-if="!multilingual" class="mt-5">
            <label class="mb-1 block text-xs font-medium text-zinc-500">Language</label>
            <select v-model="single" class="input">
              <option v-for="l in LANG_CATALOG" :key="l.code" :value="l.code">{{ l.label }}</option>
            </select>
          </div>

          <!-- Multiple -->
          <div v-else class="mt-5">
            <LocalePicker
              v-model:chosen="chosen"
              v-model:default="defaultLocale"
              grid-label="Which languages?"
            />
          </div>
        </div>

        <!-- Nav -->
        <div class="mt-7 flex items-center justify-between">
          <button
            v-if="step > 1"
            class="rounded-lg px-3 py-2 text-sm text-zinc-600 transition hover:bg-white/60"
            :disabled="busy"
            @click="step--"
          >
            Back
          </button>
          <span v-else />

          <button v-if="step < 3" class="btn btn-primary px-5" @click="step++">
            {{ step === 1 && !logoFile ? "Skip" : "Continue" }}
          </button>
          <button
            v-else
            class="btn btn-primary px-5"
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
