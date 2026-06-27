<script setup lang="ts">
// Editor for a single JSON settings file (seo.json / menu.json / redirects.json).
// Same field renderer as everything else; persists via the JSON file helpers.
import { reactive, ref, watch } from "vue";
import FieldForm from "../fields/FieldForm.vue";
import { GitHubClient } from "../backend/github";
import type { FileEntry } from "../schema";

const props = defineProps<{ client: GitHubClient; file: FileEntry }>();
const emit = defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const saving = ref(false);
const error = ref("");
const status = ref("");

const data = reactive<Record<string, unknown>>({});
let sha: string | undefined;

async function load() {
  loading.value = true;
  error.value = "";
  status.value = "";
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
  if (saving.value) return;
  error.value = "";
  status.value = "";
  saving.value = true;
  try {
    sha = await props.client.saveJson(
      props.file.file,
      { ...data },
      `cms: update ${props.file.file}`,
      sha,
    );
    status.value = "Saved ✓";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Save failed.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings">
    <header class="bar">
      <button class="ghost" @click="emit('back')">← Back</button>
      <span class="status">
        <span v-if="error" class="err">{{ error }}</span>
        <span v-else-if="status">{{ status }}</span>
      </span>
      <button class="save" :disabled="saving || loading" @click="save">
        {{ saving ? "Saving…" : "Save" }}
      </button>
    </header>

    <main class="sheet">
      <h2>{{ file.label }}</h2>
      <div v-if="loading" class="muted">Loading…</div>
      <FieldForm v-else :fields="file.fields" :data="data" :client="client" />
    </main>
  </div>
</template>

<style scoped>
.settings {
  min-height: 100vh;
}
.bar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 1.25rem;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid #ececec;
}
.ghost {
  border: none;
  background: none;
  color: #555;
  cursor: pointer;
  font: inherit;
}
.status {
  flex: 1;
  text-align: center;
  font-size: 0.85rem;
}
.err {
  color: #c0392b;
}
.muted {
  color: #999;
}
.save {
  padding: 0.45rem 1rem;
  border: none;
  border-radius: 7px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
}
.save:disabled {
  opacity: 0.5;
  cursor: default;
}
.sheet {
  max-width: 40rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 6rem;
}
h2 {
  font-family: Georgia, serif;
  margin: 0 0 1.5rem;
}
</style>
