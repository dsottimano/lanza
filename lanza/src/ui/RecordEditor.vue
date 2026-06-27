<script setup lang="ts">
// Form-only editor for body-less folder collections (categories, tags, authors).
// No writing canvas — just the schema fields. Any existing body is preserved.
import { onMounted, reactive, ref } from "vue";
import FieldForm from "../fields/FieldForm.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import { slugify } from "../backend/auth";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  path: string | null;
}>();
const emit = defineEmits<{ (e: "back", changed: boolean): void }>();

const loading = ref(true);
const error = ref("");
let committedSomething = false;

const data = reactive<Record<string, unknown>>({});
let body = "";
let sha: string | undefined;
let currentPath = props.path;

onMounted(async () => {
  try {
    if (props.path) {
      const entry = await props.client.loadEntry(props.path);
      Object.assign(data, entry.data);
      body = entry.body;
      sha = entry.sha;
    } else {
      for (const f of props.collection.fields) {
        if (f.default !== undefined) data[f.name] = f.default;
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load entry.";
  } finally {
    loading.value = false;
  }
});

async function save() {
  if (!currentPath) {
    currentPath = `${props.collection.folder}/${slugify(String(data.title ?? ""))}.md`;
  }
  sha = await props.client.saveEntry(
    currentPath,
    { ...data },
    body,
    `${sha ? "lanza: update" : "lanza: create"} ${currentPath}`,
    sha,
  );
  committedSomething = true;
}
</script>

<template>
  <div class="min-h-screen bg-zinc-50">
    <header class="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button class="text-sm text-zinc-500 transition hover:text-zinc-900" @click="emit('back', committedSomething)">
        ← {{ collection.label }}
      </button>
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

    <main class="mx-auto max-w-2xl px-6 pt-10 pb-24">
      <h1 class="mb-6 font-serif text-3xl font-bold tracking-tight text-zinc-900">
        {{ path ? "Edit" : "New" }} {{ collection.labelSingular.toLowerCase() }}
      </h1>
      <div v-if="loading" class="text-sm text-zinc-400">Loading…</div>
      <div v-else class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <FieldForm :fields="collection.fields" :data="data" :client="client" />
      </div>
    </main>
  </div>
</template>
