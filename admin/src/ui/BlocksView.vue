<script setup lang="ts">
// Settings → Blocks. Manager for reusable "My blocks" — named HTML snippets the
// user composes here and drops into any post/page from the slash menu. Stored
// shared (not localized) at frontend/data/blocks.json; a 404 = no blocks yet.
// Each block's content is edited in the same rich Editor the posts use.
import { computed, onUnmounted, reactive, ref, useTemplateRef } from "vue";
import Editor from "../editor/Editor.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import { loadBlocks, saveBlocks, type Block } from "../backend/blocks";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const blocks = reactive<Block[]>([]);
let sha: string | undefined;
const activeId = ref<string | null>(null);
const editorRef = useTemplateRef<InstanceType<typeof Editor>>("editorRef");

const activeBlock = computed(() => blocks.find((b) => b.id === activeId.value) ?? null);

const markDirty = () => (isDirty.value = true);
onUnmounted(() => (isDirty.value = false));

// Pull the live editor HTML back into the active block before we switch away
// from it or save — the editor holds the unsaved edits until then.
function flushActive() {
  const b = activeBlock.value;
  if (b && editorRef.value) b.html = editorRef.value.getHTML();
}

async function load() {
  loading.value = true;
  try {
    const loaded = await loadBlocks(props.client);
    blocks.splice(0, blocks.length, ...loaded.blocks);
    sha = loaded.sha;
    activeId.value = blocks[0]?.id ?? null;
  } catch (e) {
    reportError(e, "Failed to load blocks.");
  } finally {
    loading.value = false;
    isDirty.value = false;
  }
}
load();

function select(id: string) {
  if (id === activeId.value) return;
  flushActive();
  activeId.value = id;
}

function addBlock() {
  flushActive();
  const block: Block = { id: crypto.randomUUID(), name: "Untitled block", html: "<p></p>" };
  blocks.push(block);
  activeId.value = block.id;
  markDirty();
}

function rename(block: Block) {
  const next = window.prompt("Block name", block.name);
  if (next === null) return;
  block.name = next.trim() || "Untitled block";
  markDirty();
}

function remove(block: Block) {
  if (!window.confirm(`Delete "${block.name}"?`)) return;
  const i = blocks.findIndex((b) => b.id === block.id);
  if (i === -1) return;
  blocks.splice(i, 1);
  if (activeId.value === block.id) activeId.value = blocks[0]?.id ?? null;
  markDirty();
}

async function save() {
  flushActive();
  sha = await saveBlocks(props.client, [...blocks], sha);
  isDirty.value = false;
}

// Plain-text preview for the list (strip tags; the content is the author's own).
function preview(html: string): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 64 ? `${text.slice(0, 64)}…` : text;
}
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm">
        <span v-if="isDirty" class="text-zinc-500">Unsaved changes</span>
      </span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-5xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Blocks</h1>
      <p class="mb-6 text-sm text-zinc-600">
        Reusable snippets you can drop into any post or page with the “/” menu (under
        “My blocks”). Shared across all languages.
      </p>

      <div v-if="loading" class="card space-y-4 p-5">
        <div class="skeleton h-9 w-full" />
        <div class="skeleton h-9 w-2/3" />
      </div>

      <div v-else class="grid gap-5 md:grid-cols-[16rem_1fr]">
        <!-- Block list -->
        <aside class="card flex h-max flex-col gap-1 p-3">
          <p v-if="!blocks.length" class="px-1.5 py-2 text-sm text-zinc-500">No blocks yet.</p>
          <div
            v-for="b in blocks"
            :key="b.id"
            class="group flex items-center gap-1"
          >
            <button
              class="nav-item min-w-0 flex-1"
              :class="{ 'nav-item--active': b.id === activeId }"
              @click="select(b.id)"
            >
              <span class="block truncate font-medium">{{ b.name }}</span>
              <span
                class="block truncate text-xs"
                :class="b.id === activeId ? 'text-white/70' : 'text-zinc-500'"
              >
                {{ preview(b.html) || "Empty" }}
              </span>
            </button>
            <button
              class="grid size-7 flex-shrink-0 place-items-center rounded-md text-zinc-400 transition hover:bg-white/60 hover:text-zinc-800"
              title="Rename"
              @click="rename(b)"
            >
              ✎
            </button>
            <button
              class="grid size-7 flex-shrink-0 place-items-center rounded-md text-zinc-400 transition hover:bg-white/60 hover:text-red-600"
              title="Delete"
              @click="remove(b)"
            >
              ✕
            </button>
          </div>
          <button class="btn btn-ghost mt-2 justify-center" @click="addBlock">+ New block</button>
        </aside>

        <!-- Active block editor -->
        <section v-if="activeBlock" class="card p-6">
          <input
            v-model="activeBlock.name"
            class="input mb-4 font-serif text-lg font-semibold"
            placeholder="Block name"
            @input="markDirty"
          />
          <Editor
            ref="editorRef"
            :key="activeBlock.id"
            :initial-html="activeBlock.html"
            :client="client"
            @change="markDirty"
          />
        </section>
        <section v-else class="card grid place-items-center p-10 text-center text-sm text-zinc-500">
          <p>Create a block to start building your snippet library.</p>
        </section>
      </div>
    </main>
  </div>
</template>
