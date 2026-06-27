<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from "vue";
import Editor from "../editor/Editor.vue";
import { GitHubClient } from "../backend/github";
import { POSTS_DIR } from "../backend/config";
import { toEditorHtml } from "../backend/markdown";
import { slugify } from "../backend/auth";

const props = defineProps<{ client: GitHubClient; path: string | null }>();
const emit = defineEmits<{ (e: "back", changed: boolean): void }>();

const editorRef = useTemplateRef<InstanceType<typeof Editor>>("editorRef");

const loading = ref(true);
const saving = ref(false);
const error = ref("");
const status = ref("");
const dirty = ref(false);
let committedSomething = false;

// Frontmatter we edit in Phase 2; everything else is preserved verbatim.
const title = ref("");
const draft = ref(true);
const description = ref("");
const bodyHtml = ref("<p></p>");
let data: Record<string, unknown> = {};
let sha: string | undefined;
let currentPath = props.path;

onMounted(async () => {
  try {
    if (props.path) {
      const post = await props.client.loadPost(props.path);
      data = post.data;
      sha = post.sha;
      title.value = String(data.title ?? "");
      draft.value = data.draft !== false;
      description.value = String(data.description ?? "");
      bodyHtml.value = toEditorHtml(post.body);
    } else {
      data = { pubDate: new Date().toISOString(), draft: true };
      bodyHtml.value = "<p></p>";
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load post.";
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
    const merged: Record<string, unknown> = {
      ...data,
      title: title.value,
      draft: draft.value,
      description: description.value,
      updatedDate: new Date().toISOString(),
    };
    if (!merged.pubDate) merged.pubDate = new Date().toISOString();

    if (!currentPath) {
      currentPath = `${POSTS_DIR}/${slugify(title.value)}.md`;
    }
    sha = await props.client.savePost(
      currentPath,
      merged,
      body,
      `${sha ? "cms: update" : "cms: create"} ${currentPath}`,
      sha,
    );
    data = merged;
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
      <button class="ghost" @click="emit('back', committedSomething)">← Posts</button>
      <span class="status">
        <span v-if="error" class="err">{{ error }}</span>
        <span v-else-if="status">{{ status }}</span>
        <span v-else-if="dirty" class="muted">Unsaved changes</span>
      </span>
      <div class="actions">
        <label class="toggle">
          <input type="checkbox" :checked="!draft" @change="draft = !draft; markDirty()" />
          Published
        </label>
        <button class="save" :disabled="saving || loading" @click="save">
          {{ saving ? "Saving…" : "Save" }}
        </button>
      </div>
    </header>

    <main class="canvas">
      <div v-if="loading" class="muted center">Loading…</div>
      <div v-else class="sheet">
        <input
          v-model="title"
          class="title"
          placeholder="Post title"
          @input="markDirty"
        />
        <Editor ref="editorRef" :initial-html="bodyHtml" @change="markDirty" />
      </div>
    </main>
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
</style>
