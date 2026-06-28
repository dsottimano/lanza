<script setup lang="ts">
// Settings → Languages. Edit the site's locale set after onboarding: which
// languages exist + the default. Writes frontend/data/site.json (preserving the
// onboarded flag) through the proxy, then refreshes the in-memory config so the
// language rail updates immediately.
import { ref, computed } from "vue";
import { GitHubClient } from "../backend/github";
import { site, loadSiteConfig, SITE_CONFIG_PATH, putJsonSafe, LANG_CATALOG, type LocaleDef } from "../backend/site";
import SaveButton from "./SaveButton.vue";
import { reportError, clearError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void; (e: "saved"): void }>();

// Seed from the currently-loaded config.
const chosen = ref<string[]>(site.locales.map((l) => l.code));
const defaultLocale = ref(site.defaultLocale);

function toggle(code: string) {
  const i = chosen.value.indexOf(code);
  if (i === -1) chosen.value.push(code);
  else if (chosen.value.length > 1) chosen.value.splice(i, 1); // keep at least one
  if (!chosen.value.includes(defaultLocale.value)) defaultLocale.value = chosen.value[0];
}

const valid = computed(() => chosen.value.length >= 1 && chosen.value.includes(defaultLocale.value));

async function save() {
  // Preserve LANG_CATALOG order so the rail reads consistently.
  const locales = LANG_CATALOG.filter((l) => chosen.value.includes(l.code)) as LocaleDef[];
  await putJsonSafe(
    props.client,
    SITE_CONFIG_PATH,
    (cur) => ({ ...cur, defaultLocale: defaultLocale.value, locales, onboarded: cur.onboarded ?? true }),
    "lanza: update languages",
  );
  await loadSiteConfig(props.client);
  emit("saved");
}
</script>

<template>
  <div class="min-h-screen bg-zinc-50">
    <header class="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button class="text-sm text-zinc-500 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm"></span>
      <SaveButton
        :action="save"
        :disabled="!valid"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Languages</h1>
      <p class="mb-6 text-sm text-zinc-500">
        Pick the languages this site publishes in. Removing one hides it from the site and the
        editor — existing content files for it stay in the repo.
      </p>

      <div class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <label class="mb-2 block text-xs font-medium text-zinc-500">Enabled languages</label>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="l in LANG_CATALOG"
            :key="l.code"
            :class="['flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition', chosen.includes(l.code) ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300']"
            @click="toggle(l.code)"
          >
            <span :class="['grid size-4 place-items-center rounded border text-[10px]', chosen.includes(l.code) ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300']">
              <span v-if="chosen.includes(l.code)">✓</span>
            </span>
            {{ l.label }}
            <span class="ml-auto font-mono text-xs text-zinc-400">{{ l.code }}</span>
          </button>
        </div>

        <label class="mt-6 mb-1 block text-xs font-medium text-zinc-500">Default language</label>
        <p class="mb-2 text-xs text-zinc-400">Lives at the site root (no URL prefix); others are prefixed (/es, /fr).</p>
        <select v-model="defaultLocale" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm">
          <option v-for="c in chosen" :key="c" :value="c">
            {{ LANG_CATALOG.find((l) => l.code === c)?.label ?? c }}
          </option>
        </select>
      </div>
    </main>
  </div>
</template>
