<script setup lang="ts">
// Generic entry list for any folder collection. Entries are listed by filename
// (the slug); titles would need a per-file fetch, which isn't worth it here.
import { ref, watch } from "vue";
import { GitHubClient, type RepoFile } from "../backend/github";
import { entryFolder, type FolderCollection } from "../schema";
import type { Locale } from "../backend/config";
import { reportError } from "../errors";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
}>();
const emit = defineEmits<{
  (e: "open", path: string): void;
  (e: "new"): void;
}>();

const entries = ref<RepoFile[]>([]);
const loading = ref(true);
const failed = ref(false);

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    const folder = entryFolder(props.collection, props.locale);
    entries.value = (await props.client.listDir(folder)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch (e) {
    failed.value = true;
    reportError(e, "Failed to load entries.");
  } finally {
    loading.value = false;
  }
}

watch(() => props.collection.name, load, { immediate: true });
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-10">
    <div class="mb-7 flex items-end justify-between">
      <div>
        <h1 class="font-serif text-3xl font-bold tracking-tight text-zinc-900">{{ collection.label }}</h1>
        <p v-if="!loading && !failed" class="mt-1 text-sm text-zinc-600">
          {{ entries.length }} {{ entries.length === 1 ? "entry" : "entries" }}
        </p>
      </div>
      <button class="btn btn-primary" @click="emit('new')">
        <span class="text-base leading-none">+</span>
        New {{ collection.labelSingular.toLowerCase() }}
      </button>
    </div>

    <!-- Layout-stable skeleton: same rounded card shell as the list, so content
         appearing doesn't reflow the page. -->
    <ul v-if="loading" class="card divide-y divide-white/40 overflow-hidden">
      <li v-for="n in 5" :key="n" class="flex items-center justify-between px-4 py-3.5">
        <span class="skeleton h-3.5 w-40" />
      </li>
    </ul>

    <div v-else-if="failed" class="rounded-2xl border border-dashed border-white/50 bg-white/40 py-12 text-center">
      <p class="text-sm text-zinc-600">Couldn't load {{ collection.label.toLowerCase() }}.</p>
      <button class="mt-3 text-sm font-medium text-zinc-900 underline-offset-2 hover:underline" @click="load">
        Try again
      </button>
    </div>

    <div
      v-else-if="!entries.length"
      class="rounded-2xl border border-dashed border-white/50 bg-white/40 py-16 text-center"
    >
      <p class="text-sm text-zinc-600">No {{ collection.label.toLowerCase() }} yet.</p>
      <button
        class="mt-3 text-sm font-medium text-zinc-900 underline-offset-2 hover:underline"
        @click="emit('new')"
      >
        Create the first one →
      </button>
    </div>

    <ul v-else class="card divide-y divide-white/40 overflow-hidden">
      <li v-for="e in entries" :key="e.path">
        <button
          class="group flex w-full items-center justify-between px-4 py-3.5 text-left transition hover:bg-white/50"
          @click="emit('open', e.path)"
        >
          <span class="text-sm text-zinc-800">{{ e.name.replace(/\.md$/, "") }}</span>
          <span class="text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-zinc-600">→</span>
        </button>
      </li>
    </ul>
  </div>
</template>
