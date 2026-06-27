<script setup lang="ts">
// Form-only editor for body-less folder collections (categories, tags, authors).
// No writing canvas — just the schema fields. Any existing body is preserved.
import { onMounted, reactive, ref } from "vue";
import FieldForm from "../fields/FieldForm.vue";
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
const saving = ref(false);
const error = ref("");
const status = ref("");
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
  if (saving.value) return;
  error.value = "";
  status.value = "";
  saving.value = true;
  try {
    if (!currentPath) {
      currentPath = `${props.collection.folder}/${slugify(String(data.title ?? ""))}.md`;
    }
    sha = await props.client.saveEntry(
      currentPath,
      { ...data },
      body,
      `${sha ? "cms: update" : "cms: create"} ${currentPath}`,
      sha,
    );
    committedSomething = true;
    status.value = "Saved ✓";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Save failed.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="record">
    <header class="bar">
      <button class="ghost" @click="emit('back', committedSomething)">← {{ collection.label }}</button>
      <span class="status">
        <span v-if="error" class="err">{{ error }}</span>
        <span v-else-if="status">{{ status }}</span>
      </span>
      <button class="save" :disabled="saving || loading" @click="save">
        {{ saving ? "Saving…" : "Save" }}
      </button>
    </header>

    <main class="sheet">
      <div v-if="loading" class="muted">Loading…</div>
      <FieldForm v-else :fields="collection.fields" :data="data" :client="client" />
    </main>
  </div>
</template>

<style scoped>
.record {
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
  padding: 2.5rem 1.25rem 6rem;
}
</style>
