<script setup lang="ts">
// Editor for a single JSON settings file (seo.json / menu.json / redirects.json).
// Same field renderer as everything else; persists via the JSON file helpers.
import { reactive, ref, watch } from "vue";
import FieldForm from "../fields/FieldForm.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import type { FileEntry } from "../schema";

const props = defineProps<{ client: GitHubClient; file: FileEntry }>();
const emit = defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const error = ref("");

const data = reactive<Record<string, unknown>>({});
let sha: string | undefined;

async function load() {
  loading.value = true;
  error.value = "";
  for (const k of Object.keys(data)) delete data[k];
  try {
    const loaded = await props.client.loadJson(props.file.file);
    Object.assign(data, loaded.data);
    sha = loaded.sha;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load settings.";
  } finally {
    loading.value = false;
  }
}

watch(() => props.file.name, load, { immediate: true });

async function save() {
  sha = await props.client.saveJson(
    props.file.file,
    { ...data },
    `lanza: update ${props.file.file}`,
    sha,
  );
}
</script>

<template>
  <div class="min-h-screen bg-zinc-50">
    <header class="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button class="text-sm text-zinc-500 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm">
        <span v-if="error" class="text-rose-600">{{ error }}</span>
      </span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="error = ''"
        @error="(m) => (error = m)"
      />
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-8 pb-24">
      <h1 class="mb-6 font-serif text-3xl font-bold tracking-tight text-zinc-900">{{ file.label }}</h1>
      <div v-if="loading" class="text-sm text-zinc-400">Loading…</div>
      <div v-else class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <FieldForm :fields="file.fields" :data="data" :client="client" />
      </div>
    </main>
  </div>
</template>
