<script setup lang="ts">
// Form-only editor for body-less folder collections (categories, tags, authors).
// No writing canvas — just the schema fields. Any existing body is preserved.
import FieldForm from "../fields/FieldForm.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import type { Locale } from "../backend/config";
import { reportError, clearError } from "../errors";
import { useEntryEditor } from "./useEntryEditor";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
  path: string | null;
}>();
const emit = defineEmits<{ (e: "back"): void }>();

// Body-less collection: keep whatever body the file already had and re-commit it
// untouched (this editor only edits frontmatter fields).
let body = "";
const { data, loading, save, markDirty } = useEntryEditor(props, {
  onLoaded: (loadedBody) => (body = loadedBody),
  getBody: () => body,
});
</script>

<template>
  <div class="min-h-screen bg-zinc-50">
    <header class="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button class="text-sm text-zinc-500 transition hover:text-zinc-900" @click="emit('back')">
        ← {{ collection.label }}
      </button>
      <span class="flex-1 text-center text-sm"></span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-10 pb-24">
      <h1 class="mb-6 font-serif text-3xl font-bold tracking-tight text-zinc-900">
        {{ path ? "Edit" : "New" }} {{ collection.labelSingular.toLowerCase() }}
      </h1>
      <div v-if="loading" class="text-sm text-zinc-400">Loading…</div>
      <div
        v-else
        class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
        @input="markDirty"
        @change="markDirty"
      >
        <FieldForm :fields="collection.fields" :data="data" :client="client" :locale="locale" />
      </div>
    </main>
  </div>
</template>
