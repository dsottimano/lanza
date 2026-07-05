<script setup lang="ts">
// Form-only editor for body-less folder collections (categories, tags, authors).
// No writing canvas — just the schema fields. Any existing body is preserved.
import { computed, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import FieldForm from "../fields/FieldForm.vue";
import SlugField from "./SlugField.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import type { Locale } from "../backend/config";
import { slugify } from "../backend/slug";
import { entryRoute } from "../router";
import { reportError, clearError } from "../errors";
import { useEntryEditor } from "./useEntryEditor";
import { refreshPending } from "./staging";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
  path: string | null;
}>();
const emit = defineEmits<{ (e: "back"): void }>();

const router = useRouter();
const route = useRoute();

// The entry's slug is its filename (basename of `path`); editing it renames the
// file on save. "" for a new entry → derived from the title.
const originalSlug = props.path ? props.path.replace(/\.md$/, "").split("/").pop()! : "";
const slug = ref(originalSlug);

// Body-less collection: keep whatever body the file already had and re-commit it
// untouched (this editor only edits frontmatter fields).
let body = "";
const { data, loading, save, markDirty } = useEntryEditor(props, {
  onLoaded: (loadedBody) => (body = loadedBody),
  getBody: () => body,
  getSlug: () => slug.value,
});

const slugPlaceholder = computed(() => slugify(String(data.title ?? "")));
// The slug actually saved (matches useEntryEditor): typed → slugified, else title.
const effectiveSlug = computed(() =>
  slug.value.trim() ? slugify(slug.value) : slugPlaceholder.value,
);

// A slug change renamed the file → keep the URL in sync (existing entries only).
// Saving also commits to staging, so refresh the shared "to publish" count.
function onSaved() {
  clearError();
  refreshPending(props.client);
  const saved = effectiveSlug.value;
  if (props.path && route.params.slug !== saved) {
    router.replace(entryRoute(props.collection.name, props.locale, saved));
  }
}
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">
        ← {{ collection.label }}
      </button>
      <span class="flex-1 text-center text-sm"></span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="onSaved"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-3xl px-6 pt-10 pb-24">
      <h1 class="mb-2 font-serif text-3xl font-bold tracking-tight text-zinc-900">
        {{ path ? "Edit" : "New" }} {{ collection.labelSingular.toLowerCase() }}
      </h1>
      <div v-if="!loading" class="mb-6" @input="markDirty">
        <SlugField
          v-model="slug"
          prefix=""
          suffix=""
          label="Slug"
          :placeholder="slugPlaceholder"
        />
      </div>
      <div v-if="loading" class="card space-y-4 p-6">
        <div class="skeleton h-4 w-28" />
        <div class="skeleton h-9 w-full" />
        <div class="skeleton h-4 w-28" />
        <div class="skeleton h-9 w-full" />
      </div>
      <div
        v-else
        class="card p-6"
        @input="markDirty"
        @change="markDirty"
      >
        <FieldForm :fields="collection.fields" :data="data" :client="client" :locale="locale" dense />
      </div>
    </main>
  </div>
</template>
