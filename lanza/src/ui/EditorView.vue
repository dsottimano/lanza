<script setup lang="ts">
// Rich-body entry editor (posts & pages). The writing canvas stays front and
// centre; every structured field lives in a Ghost-style slide-in drawer driven
// by the collection schema. Title and the draft/publish toggle are surfaced in
// the chrome, so they're excluded from the drawer.
import { computed, onMounted, reactive, ref, useTemplateRef } from "vue";
import Editor from "../editor/Editor.vue";
import FieldForm from "../fields/FieldForm.vue";
import SaveButton from "./SaveButton.vue";
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
const error = ref("");
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
    `${sha ? "lanza: update" : "lanza: create"} ${currentPath}`,
    sha,
  );
  dirty.value = false;
  committedSomething = true;
}

function markDirty() {
  dirty.value = true;
}
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button
        class="text-sm text-zinc-500 transition hover:text-zinc-900"
        @click="emit('back', committedSomething)"
      >
        ← {{ collection.label }}
      </button>

      <span class="flex-1 text-center text-sm">
        <span v-if="error" class="text-rose-600">{{ error }}</span>
        <span v-else-if="dirty" class="text-zinc-400">Unsaved changes</span>
      </span>

      <div class="flex items-center gap-3">
        <!-- Published toggle -->
        <label class="flex cursor-pointer items-center gap-2 text-sm text-zinc-600">
          <span
            class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
            :class="data.draft === false ? 'bg-emerald-500' : 'bg-zinc-300'"
          >
            <input
              type="checkbox"
              class="sr-only"
              :checked="data.draft === false"
              @change="data.draft = (($event.target as HTMLInputElement).checked ? false : true); markDirty()"
            />
            <span
              class="size-4 rounded-full bg-white shadow transition-transform"
              :class="data.draft === false ? 'translate-x-4' : 'translate-x-0.5'"
            />
          </span>
          Published
        </label>

        <button
          class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
          title="Settings"
          @click="drawerOpen = true"
        >
          ⚙ Settings
        </button>

        <SaveButton
          :action="save"
          :disabled="loading"
          @saved="error = ''"
          @error="(m) => (error = m)"
        />
      </div>
    </header>

    <main class="flex flex-1 justify-center px-5 pt-12 pb-24">
      <div v-if="loading" class="self-center text-sm text-zinc-400">Loading…</div>
      <div v-else class="w-full max-w-2xl">
        <input
          v-model="data.title"
          class="mb-6 w-full border-none font-serif text-5xl font-bold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300"
          :placeholder="`${collection.labelSingular} title`"
          @input="markDirty"
        />
        <Editor ref="editorRef" :initial-html="bodyHtml" :client="client" @change="markDirty" />
      </div>
    </main>

    <!-- Ghost-style settings drawer -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="drawerOpen" class="fixed inset-0 z-40 bg-black/20" @click="drawerOpen = false" />
    </Transition>
    <aside
      class="fixed top-0 right-0 z-50 flex h-screen w-[min(420px,92vw)] flex-col border-l border-zinc-200 bg-white shadow-2xl transition-transform duration-200"
      :class="drawerOpen ? 'translate-x-0' : 'translate-x-full'"
      @input="markDirty"
      @change="markDirty"
    >
      <div class="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <strong class="text-sm font-semibold text-zinc-900">{{ collection.labelSingular }} settings</strong>
        <button class="text-zinc-400 transition hover:text-zinc-900" @click="drawerOpen = false">✕</button>
      </div>
      <div class="flex-1 overflow-y-auto p-5">
        <FieldForm v-if="!loading" :fields="drawerFields" :data="data" :client="client" />
      </div>
    </aside>
  </div>
</template>
