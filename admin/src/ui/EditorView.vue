<script setup lang="ts">
// Rich-body entry editor (posts, pages, listings). The writing canvas stays the
// centre of gravity; on wide screens every structured field lives in a
// persistent, independently-scrollable "details" column beside the paper. On
// narrow screens that column stacks below the canvas. Title and the draft/
// publish toggle are surfaced in the chrome, so they're excluded from the panel.
import { computed, ref, useTemplateRef } from "vue";
import Editor from "../editor/Editor.vue";
import Toolbar from "../editor/Toolbar.vue";
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

// The details panel shows every field except the ones promoted into the chrome.
const panelFields = computed<Field[]>(() =>
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

        <SaveButton
          :action="save"
          :disabled="loading"
          @saved="clearError"
          @error="(e) => reportError(e, 'Save failed.')"
        />
      </div>
    </header>

    <main class="flex flex-1 justify-center px-5 pt-10 pb-24">
      <!-- Canvas + details share one layout container so widths stay stable
           whether loading or loaded, and the two collapse to a single column
           below `lg`. Paper (max 64rem) + column (~23rem) + gap fit under ~90rem. -->
      <div class="flex w-full max-w-[90rem] flex-col gap-8 lg:flex-row lg:items-start">
        <!-- Writing canvas -->
        <div class="w-full min-w-0 lg:max-w-5xl lg:flex-1">
          <!-- Layout-stable skeleton mirroring the title + first body lines. -->
          <div v-if="loading" class="editor-paper w-full">
            <div class="skeleton mb-8 h-12 w-3/4" />
            <div class="skeleton mb-3 h-4 w-full" />
            <div class="skeleton mb-3 h-4 w-11/12" />
            <div class="skeleton h-4 w-4/5" />
          </div>
          <!-- Calm, near-opaque "paper" surface — writing comfort beats effect. -->
          <div v-else class="editor-paper w-full">
            <!-- Formatting bar hoisted above the title: it drives the editor
                 instance (exposed by Editor.vue) and stays sticky while writing.
                 Guarded until the editor is created on mount. -->
            <Toolbar
              v-if="editorRef?.editor"
              :editor="editorRef.editor"
              :on-link="editorRef.link"
            />
            <input
              v-model="data.title"
              class="mx-auto mb-6 block w-full max-w-[46rem] border-none bg-transparent font-serif text-5xl font-bold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300"
              :placeholder="`${collection.labelSingular} title`"
              @input="markDirty"
            />
            <Editor ref="editorRef" :initial-html="bodyHtml" :client="client" @change="markDirty" />
          </div>
        </div>

        <!-- Persistent details column: sticky + independently scrollable on wide
             screens, stacked below the canvas on narrow ones. -->
        <aside
          class="w-full shrink-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:w-[23rem] lg:overflow-y-auto rail-scroll"
          @input="markDirty"
          @change="markDirty"
        >
          <div class="card p-4">
            <h2 class="mb-3 border-b border-[var(--border)] pb-3 text-sm font-semibold text-zinc-900">
              {{ collection.labelSingular }} details
            </h2>
            <div v-if="loading" class="space-y-4">
              <div class="skeleton h-4 w-24" />
              <div class="skeleton h-9 w-full" />
              <div class="skeleton h-4 w-24" />
              <div class="skeleton h-9 w-full" />
              <div class="skeleton h-4 w-24" />
              <div class="skeleton h-9 w-full" />
            </div>
            <FieldForm
              v-else
              :fields="panelFields"
              :data="data"
              :client="client"
              :locale="locale"
              dense
            />
          </div>
        </aside>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Flat Paper surface for the writing canvas — an opaque sheet with a hairline
   rule, matching the site's editorial ground (no glass). */
.editor-paper {
  border-radius: var(--radius);
  background: var(--paper-card);
  border: 1px solid var(--border);
  padding: 2.75rem 3rem 3.5rem;
}
@media (max-width: 640px) {
  .editor-paper {
    padding: 1.75rem 1.5rem 2.5rem;
  }
}
</style>
