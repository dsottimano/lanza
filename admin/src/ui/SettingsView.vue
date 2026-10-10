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

// Capture the loaded/saved snapshot, rather than clearing the dirty flag after
// every response: the user can keep editing while a save is in flight.
const loadFailed = ref(false);
const saving = ref(false);
let generation = 0;
let baseline = "";
let active = true;
watch(data, () => {
  if (!loading.value && !loadFailed.value) isDirty.value = JSON.stringify(data) !== baseline;
}, { deep: true, flush: "sync" });
onUnmounted(() => { active = false; generation++; isDirty.value = false; });

async function load() {
  const request = ++generation;
  loading.value = true;
  loadFailed.value = false;
  sha = undefined;
  for (const k of Object.keys(data)) delete data[k];
  isDirty.value = false;
  try {
    const loaded = await props.client.loadJson(path.value);
    if (!active || request !== generation) return;
    Object.assign(data, loaded.data);
    sha = loaded.sha;
    baseline = JSON.stringify(data);
  } catch (e) {
    if (!active || request !== generation) return;
    loadFailed.value = true;
    reportError(e, "Failed to load settings.");
  } finally {
    if (active && request === generation) loading.value = false;
  }
}

watch(path, load, { immediate: true });

async function save() {
  if (loading.value || loadFailed.value || saving.value) return;
  const request = generation;
  const target = path.value;
  const snapshot = JSON.stringify(data);
  saving.value = true;
  try {
    const nextSha = await props.client.saveJson(
      target, JSON.parse(snapshot), `lanza: update ${target}`, sha,
    );
    if (!active || request !== generation) return;
    sha = nextSha;
    baseline = snapshot;
    isDirty.value = JSON.stringify(data) !== baseline;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings-page">
    <SettingsHeader :title="file.label + (file.localized ? ` · ${localeLabel(locale)}` : '')" @back="$emit('back')">
      <template #actions>
        <SaveButton
          :action="save"
          :disabled="loading || loadFailed || saving"
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
      <div v-else-if="loadFailed" class="card p-6" role="alert">
        <p>Settings could not be loaded. Retry before editing.</p>
        <button class="btn btn-ghost mt-3" @click="load">Retry loading</button>
      </div>
      <div
        v-else
        class="card p-6"
      >
        <FieldForm :fields="file.fields" :data="data" :client="client" :locale="locale" />
      </div>
    </main>
  </div>
</template>
