<script setup lang="ts">
// Rich-body entry editor (posts & pages). The writing canvas stays front and
// centre; every structured field lives in a Ghost-style slide-in drawer driven
// by the collection schema. Title and the draft/publish toggle are surfaced in
// the chrome, so they're excluded from the drawer.
import { computed, ref, useTemplateRef } from "vue";
import Editor from "../editor/Editor.vue";
import FieldForm from "../fields/FieldForm.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import { type FolderCollection, type Field } from "../schema";
import type { Locale } from "../backend/config";
import { toEditorHtml } from "../backend/markdown";
import { reportError, clearError } from "../errors";
import { useEntryEditor } from "./useEntryEditor";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
  path: string | null;
}>();
const emit = defineEmits<{ (e: "back"): void }>();

const editorRef = useTemplateRef<InstanceType<typeof Editor>>("editorRef");

const drawerOpen = ref(false);
const bodyHtml = ref("<p></p>");

// Frontmatter lives in `data`; the body is the live editor HTML, read at save.
// `dirty`/`markDirty` are the shared unsaved-changes signal (see useEntryEditor).
const { data, loading, save, dirty, markDirty } = useEntryEditor(props, {
  onLoaded: (body, isNew) => {
    if (isNew) {
      // Seed a publish date for collections that have one (posts).
      if (props.collection.fields.some((f) => f.name === "pubDate") && !data.pubDate) {
        data.pubDate = new Date().toISOString();
      }
      bodyHtml.value = "<p></p>";
    } else {
      bodyHtml.value = toEditorHtml(body); // bot markdown drafts → HTML canvas
    }
  },
  getBody: () => editorRef.value?.getHTML() ?? "",
  beforeSave: () => {
    if (props.collection.name === "posts") data.updatedDate = new Date().toISOString();
  },
});

// Drawer shows every field except the ones promoted into the chrome.
const drawerFields = computed<Field[]>(() =>
  props.collection.fields.filter((f) => f.name !== "title" && f.name !== "draft"),
);
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button
        class="text-sm text-zinc-600 transition hover:text-zinc-900"
        @click="emit('back')"
      >
        ← {{ collection.label }}
      </button>

      <span class="flex-1 text-center text-sm">
        <span v-if="dirty" class="text-zinc-500">Unsaved changes</span>
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
              @change="data.draft = !($event.target as HTMLInputElement).checked; markDirty()"
            />
            <span
              class="size-4 rounded-full bg-white shadow transition-transform"
              :class="data.draft === false ? 'translate-x-4' : 'translate-x-0.5'"
            />
          </span>
          Published
        </label>

        <button class="btn btn-ghost" title="Settings" @click="drawerOpen = true">
          ⚙ Settings
        </button>

        <SaveButton
          :action="save"
          :disabled="loading"
          @saved="clearError"
          @error="(e) => reportError(e, 'Save failed.')"
        />
      </div>
    </header>

    <main class="flex flex-1 justify-center px-5 pt-12 pb-24">
      <!-- Layout-stable skeleton mirroring the title + first body lines. -->
      <div v-if="loading" class="w-full max-w-2xl">
        <div class="skeleton mb-8 h-12 w-3/4" />
        <div class="skeleton mb-3 h-4 w-full" />
        <div class="skeleton mb-3 h-4 w-11/12" />
        <div class="skeleton h-4 w-4/5" />
      </div>
      <!-- Calm, near-opaque "paper" surface — writing comfort beats effect. -->
      <div v-else class="editor-paper w-full max-w-2xl">
        <input
          v-model="data.title"
          class="mb-6 w-full border-none bg-transparent font-serif text-5xl font-bold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300"
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
      class="glass-strong fixed top-0 right-0 z-50 flex h-screen w-[min(420px,92vw)] flex-col transition-transform duration-200"
      :class="drawerOpen ? 'translate-x-0' : 'translate-x-full'"
      @input="markDirty"
      @change="markDirty"
    >
      <div class="flex items-center justify-between border-b border-white/40 px-5 py-4">
        <strong class="text-sm font-semibold text-zinc-900">{{ collection.labelSingular }} settings</strong>
        <button class="text-zinc-500 transition hover:text-zinc-900" @click="drawerOpen = false">✕</button>
      </div>
      <div class="flex-1 overflow-y-auto p-5">
        <FieldForm v-if="!loading" :fields="drawerFields" :data="data" :client="client" :locale="locale" />
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* Calm paper surface for the writing canvas — near-opaque so long-form editing
   stays comfortable and high-contrast, only a whisper of the glass system. */
.editor-paper {
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid var(--glass-border-soft);
  box-shadow: 0 18px 50px -20px rgba(30, 41, 80, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  padding: 2.75rem 3rem 3.5rem;
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .editor-paper {
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
}
@media (max-width: 640px) {
  .editor-paper {
    padding: 1.75rem 1.5rem 2.5rem;
  }
}
</style>
