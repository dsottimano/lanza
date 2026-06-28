<script setup lang="ts">
// Editor for a single JSON settings file (seo.json / menu.json / redirects.json).
// Same field renderer as everything else; persists via the JSON file helpers.
import { computed, reactive, ref, watch } from "vue";
import FieldForm from "../fields/FieldForm.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import { fileEntryPath, type FileEntry } from "../schema";
import { LOCALE_LABEL, type Locale } from "../backend/config";
import { reportError, clearError } from "../errors";

const props = defineProps<{
  client: GitHubClient;
  file: FileEntry;
  locale: Locale;
}>();
const emit = defineEmits<{ (e: "back"): void }>();

const loading = ref(true);

// The actual repo path — the active locale's variant for localized files.
const path = computed(() => fileEntryPath(props.file, props.locale));

const data = reactive<Record<string, unknown>>({});
let sha: string | undefined;

async function load() {
  loading.value = true;
  for (const k of Object.keys(data)) delete data[k];
  try {
    const loaded = await props.client.loadJson(path.value);
    Object.assign(data, loaded.data);
    sha = loaded.sha;
  } catch (e) {
    reportError(e, "Failed to load settings.");
  } finally {
    loading.value = false;
  }
}

watch(path, load, { immediate: true });

async function save() {
  sha = await props.client.saveJson(
    path.value,
    { ...data },
    `lanza: update ${path.value}`,
    sha,
  );
}
</script>

<template>
  <div class="min-h-screen bg-zinc-50">
    <header class="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button class="text-sm text-zinc-500 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm"></span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-8 pb-24">
      <h1 class="mb-6 font-serif text-3xl font-bold tracking-tight text-zinc-900">
        {{ file.label }}
        <span v-if="file.localized" class="ml-2 align-middle text-base font-medium text-zinc-400">
          · {{ LOCALE_LABEL[locale] }}
        </span>
      </h1>
      <div v-if="loading" class="text-sm text-zinc-400">Loading…</div>
      <div v-else class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <FieldForm :fields="file.fields" :data="data" :client="client" />
      </div>
    </main>
  </div>
</template>
