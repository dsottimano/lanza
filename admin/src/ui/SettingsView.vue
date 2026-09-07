<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
// Editor for a single JSON settings file (seo.json / menu.json / redirects.json).
// Same field renderer as everything else; persists via the JSON file helpers.
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import FieldForm from "../fields/FieldForm.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import { fileEntryPath, type FileEntry } from "../schema";
import type { Locale } from "../backend/config";
import { localeLabel } from "../backend/site";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

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

// Shared unsaved-changes signal (App.vue guards navigation on it). Reset it when
// a settings file loads or unmounts so it only reflects this pane's live edits.
const markDirty = () => (isDirty.value = true);
onUnmounted(() => (isDirty.value = false));

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
    isDirty.value = false;
  }
}

watch(path, load, { immediate: true });

async function save() {
  // A stale SHA is surfaced; local form values stay dirty for recovery.
  sha = await props.client.saveJson(
    path.value,
    { ...data },
    `lanza: update ${path.value}`,
    sha,
  );
  isDirty.value = false;
}
</script>

<template>
  <div class="settings-page">
    <SettingsHeader :title="file.label + (file.localized ? ` · ${localeLabel(locale)}` : '')" @back="$emit('back')">
      <template #actions>
        <SaveButton
          :action="save"
          :disabled="loading"
          @saved="clearError"
          @error="(e) => reportError(e, 'Save failed.')"
        />
      </template>
      <template v-if="file.name === 'seo_defaults'" #description>
        <p>Set how your site appears in search results and shared links.</p>
      </template>
    </SettingsHeader>

    <main class="settings-body">
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
        <FieldForm :fields="file.fields" :data="data" :client="client" :locale="locale" />
      </div>
    </main>
  </div>
</template>
