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
import { isDirty } from "./dirty";
import { refreshPending } from "./staging";
import { access } from "../backend/access";
import { useEditorSiteTools } from "./useEditorSiteTools";

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
const { data, loading, loadFailed, saving, saveError, currentPath, save, markDirty, pauseAutosave,
  getRevision, getBaseSha } = useEntryEditor(props, {
  onLoaded: (loadedBody) => (body = loadedBody),
  getBody: () => body,
  getSlug: () => slug.value,
  onSaved: syncSavedPath,
});

const form = ref<InstanceType<typeof FieldForm>>();
const selectedField = ref<string | null>(null);
const siteToolsSession = crypto.randomUUID();
useEditorSiteTools({
  data, fields: () => props.collection.fields,
  context: () => ({ repository: access.repo, collection: props.collection.name, locale: props.locale,
    path: currentPath.value, selectedField: selectedField.value, dirty: isDirty.value, baseSha: getBaseSha() }),
  revision: () => `${siteToolsSession}:${getRevision()}:${getBaseSha() ?? "new"}`,
  ready: () => access.loaded && !loading.value && !loadFailed.value && !saving.value && !saveError.value,
  canEdit: () => access.loaded && (access.role === "owner" || access.role === "editor"),
  pauseAutosave,
  focus: async path => { const focused = await form.value?.focusField(path) ?? false;
    if (focused) selectedField.value = path;
    return focused; },
});

const slugPlaceholder = computed(() => slugify(String(data.title ?? "")));
// Follow the path returned by the completed save, not the current slug input.
// Remounting a record while newer edits are dirty would discard those edits.
function syncSavedPath(path: string) {
  if (isDirty.value) return;
  const saved = path.replace(/\.md$/, "").split("/").pop()!;
  if (route.params.slug !== saved) {
    void router.replace(entryRoute(props.collection.name, props.locale, saved));
  }
}

function onSaved() {
  clearError();
  void refreshPending(props.client);
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
        :disabled="loading || loadFailed"
        @saved="onSaved"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-3xl px-6 pt-10 pb-24">
      <h1 class="mb-2 font-serif text-3xl font-bold tracking-tight text-zinc-900">
        {{ path ? "Edit" : "New" }} {{ collection.labelSingular.toLowerCase() }}
      </h1>
      <div v-if="!loading && !loadFailed" class="mb-6" @input="markDirty">
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
      <div v-else-if="loadFailed" class="card p-6" role="alert">
        This entry could not be loaded. Reload before editing it.
      </div>
      <div
        v-else
        class="card p-6"
        @input="markDirty"
        @change="markDirty"
      >
        <FieldForm ref="form" :fields="collection.fields" :data="data" :client="client" :locale="locale" dense
          @focus-field="selectedField = $event" />
      </div>
    </main>
  </div>
</template>
