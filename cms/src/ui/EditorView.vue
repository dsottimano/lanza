<script setup lang="ts">
// Rich-body entry editor (posts & pages). The writing canvas stays front and
// centre; every structured field lives in a Ghost-style slide-in drawer driven
// by the collection schema. Title and the draft/publish toggle are surfaced in
// the chrome, so they're excluded from the drawer.
import { computed, onMounted, reactive, ref, useTemplateRef } from "vue";
import Editor from "../editor/Editor.vue";
import FieldForm from "../fields/FieldForm.vue";
import { GitHubClient } from "../backend/github";
import type { FolderCollection, Field } from "../schema";
import { toEditorHtml } from "../backend/markdown";
import { slugify } from "../backend/auth";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  path: string | null;
}>();
const emit = defineEmits<{ (e: "back", changed: boolean): void }>();

const editorRef = useTemplateRef<InstanceType<typeof Editor>>("editorRef");

const loading = ref(true);
const saving = ref(false);
const error = ref("");
const status = ref("");
const dirty = ref(false);
const drawerOpen = ref(false);
let committedSomething = false;

// All editable frontmatter lives here; unknown keys are preserved verbatim.
const data = reactive<Record<string, unknown>>({});
const bodyHtml = ref("<p></p>");
let sha: string | undefined;
let currentPath = props.path;

// Drawer shows every field except the ones promoted into the chrome.
const drawerFields = computed<Field[]>(() =>
  props.collection.fields.filter((f) => f.name !== "title" && f.name !== "draft"),
);

function applyDefaults() {
  for (const f of props.collection.fields) {
    if (f.default !== undefined && data[f.name] === undefined) data[f.name] = f.default;
  }
}

onMounted(async () => {
  try {
    if (props.path) {
      const entry = await props.client.loadEntry(props.path);
      Object.assign(data, entry.data);
      sha = entry.sha;
      bodyHtml.value = toEditorHtml(entry.body);
    } else {
      applyDefaults();
      if (props.collection.fields.some((f) => f.name === "pubDate") && !data.pubDate) {
        data.pubDate = new Date().toISOString();
      }
      bodyHtml.value = "<p></p>";
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
    const body = editorRef.value?.getHTML() ?? "";
    if (props.collection.name === "posts") data.updatedDate = new Date().toISOString();

    if (!currentPath) {
      const slug = slugify(String(data.title ?? ""));
      currentPath = `${props.collection.folder}/${slug}.md`;
    }
    sha = await props.client.saveEntry(
      currentPath,
      { ...data },
      body,
      `${sha ? "cms: update" : "cms: create"} ${currentPath}`,
      sha,
    );
    dirty.value = false;
    committedSomething = true;
    status.value = "Saved ✓";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Save failed.";
  } finally {
    saving.value = false;
  }
}

function markDirty() {
  dirty.value = true;
  status.value = "";
}
</script>

<template>
  <div class="editor-view">
    <header class="bar">
      <button class="ghost" @click="emit('back', committedSomething)">
        ← {{ collection.label }}
      </button>
      <span class="status">
        <span v-if="error" class="err">{{ error }}</span>
        <span v-else-if="status">{{ status }}</span>
        <span v-else-if="dirty" class="muted">Unsaved changes</span>
      </span>
      <div class="actions">
        <label class="toggle">
          <input
            type="checkbox"
            :checked="data.draft === false"
            @change="data.draft = (($event.target as HTMLInputElement).checked ? false : true); markDirty()"
          />
          Published
        </label>
        <button class="ghost gear" @click="drawerOpen = true" title="Settings">⚙ Settings</button>
        <button class="save" :disabled="saving || loading" @click="save">
          {{ saving ? "Saving…" : "Save" }}
        </button>
      </div>
    </header>

    <main class="canvas">
      <div v-if="loading" class="muted center">Loading…</div>
      <div v-else class="sheet">
        <input
          v-model="data.title"
          class="title"
          :placeholder="`${collection.labelSingular} title`"
          @input="markDirty"
        />
        <Editor ref="editorRef" :initial-html="bodyHtml" @change="markDirty" />
      </div>
    </main>

    <!-- Ghost-style settings drawer -->
    <div v-if="drawerOpen" class="scrim" @click="drawerOpen = false" />
    <aside class="drawer" :class="{ open: drawerOpen }" @input="markDirty" @change="markDirty">
      <div class="drawerhead">
        <strong>{{ collection.labelSingular }} settings</strong>
        <button class="ghost" @click="drawerOpen = false">✕</button>
      </div>
      <div class="drawerbody">
        <FieldForm v-if="!loading" :fields="drawerFields" :data="data" :client="client" />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.editor-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
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
.gear {
  color: #444;
}
.status {
  flex: 1;
  text-align: center;
  font-size: 0.85rem;
}
.muted {
  color: #999;
}
.err {
  color: #c0392b;
}
.actions {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: #555;
  cursor: pointer;
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
.canvas {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 3rem 1.25rem 6rem;
}
.center {
  align-self: center;
}
.sheet {
  width: 100%;
  max-width: 44rem;
}
.title {
  width: 100%;
  border: none;
  outline: none;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 2.6rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: #1a1a1a;
  margin-bottom: 1.4rem;
}
.title::placeholder {
  color: #cfcfcf;
}
.scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
  z-index: 40;
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 50;
  width: min(420px, 92vw);
  height: 100vh;
  background: #fff;
  border-left: 1px solid #e6e6e6;
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.08);
  transform: translateX(100%);
  transition: transform 0.18s ease;
  display: flex;
  flex-direction: column;
}
.drawer.open {
  transform: translateX(0);
}
.drawerhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid #eee;
}
.drawerbody {
  flex: 1;
  overflow-y: auto;
  padding: 1.1rem;
}
</style>
