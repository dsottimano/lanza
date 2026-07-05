<script setup lang="ts">
// Entry editor for posts + pages. Two shapes, chosen by whether the page actually
// uses its rich body:
//   • Templated page (a `preset` whose template doesn't render {{{ body }}}) → the
//     writing canvas is dead weight, so it's hidden. Instead: Template picker +
//     slot fields on the left, a LIVE PREVIEW of the rendered template on the right.
//   • Everything else (posts, plain pages, body-using templates) → the writing
//     canvas stays the centre of gravity with a details rail beside it.
// Shared chrome (title, the Draft⟷Ready state, Save, the "N to publish" pending
// count) lives in the header for both.
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter, useRoute } from "vue-router";
import Editor from "../editor/Editor.vue";
import Toolbar from "../editor/Toolbar.vue";
import FieldForm from "../fields/FieldForm.vue";
import TemplateEditor from "./TemplateEditor.vue";
import PreviewPane from "./PreviewPane.vue";
import SlugField from "./SlugField.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import { type FolderCollection, type Field } from "../schema";
import type { Locale } from "../backend/config";
import { listTemplates, type TemplateInfo } from "../backend/templates";
import { toEditorHtml } from "../backend/markdown";
import { slugify } from "../backend/slug";
import { site } from "../backend/site";
import { entryRoute } from "../router";
import { reportError, clearError } from "../errors";
import { useEntryEditor } from "./useEntryEditor";
import { pendingCount, refreshPending } from "./staging";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
  path: string | null;
}>();
const emit = defineEmits<{ (e: "back"): void }>();

const router = useRouter();
const route = useRoute();
const editorRef = useTemplateRef<InstanceType<typeof Editor>>("editorRef");

const bodyHtml = ref("<p></p>");

// ── slug / URL ────────────────────────────────────────────────────────────
// The entry's slug is its filename (basename of `path`); "" for a new entry, which
// derives from the title. Editing it renames the file on save (useEntryEditor).
const originalSlug = props.path
  ? props.path.replace(/\.md$/, "").split("/").pop()!
  : "";
const slug = ref(originalSlug);
// "home" is the site root (→ `/`); renaming it would break the root, so it's locked.
const isHome = computed(() => props.collection.name === "pages" && originalSlug === "home");
const slugPlaceholder = computed(() => slugify(String(data.title ?? "")));
// The slug actually saved (matches useEntryEditor): typed → slugified, else title.
const effectiveSlug = computed(() =>
  slug.value.trim() ? slugify(slug.value) : slugPlaceholder.value,
);
// Public URL framing — only pages have a simple, derivable path. The default locale
// sits at the root; others under /<locale>/.
const isPages = computed(() => props.collection.name === "pages");
const urlPrefix = computed(() =>
  !isPages.value ? "" : props.locale === site.defaultLocale ? "/" : `/${props.locale}/`,
);
const urlSuffix = computed(() => (isPages.value ? "/" : ""));

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
  // The templated (no-canvas) shape never mounts the Editor; getHTML falls back to
  // the loaded body so saving a templated page doesn't wipe a body it isn't showing.
  getBody: () => editorRef.value?.getHTML() ?? bodyHtml.value,
  beforeSave: () => {
    if (props.collection.name === "posts") data.updatedDate = new Date().toISOString();
  },
  getSlug: () => (isHome.value ? originalSlug : slug.value),
});

// ── templates: one load feeds the picker, the show-body decision + the preview ──
const templates = ref<TemplateInfo[]>([]);
const templatesLoading = ref(false);

// Collections with a `preset` field get the Template surface (picker + slots +
// preview). Posts don't — they're always the writing canvas.
const hasTemplate = computed(() => props.collection.fields.some((f) => f.name === "preset"));

const selectedTemplate = computed(() =>
  templates.value.find((t) => t.name === data.preset),
);

// Show the writing canvas when the collection has a rich body AND either no template
// is chosen or the chosen template opts into the body ({{{ body }}}, fields.json
// `"body": true`). A templated page that doesn't use the body hides the canvas.
// While templates are still loading, a chosen preset is assumed body-less so the
// canvas never flashes in.
const showBody = computed(
  () =>
    props.collection.body === "rich" &&
    (!data.preset || selectedTemplate.value?.body === true),
);

// The live-preview shape: a template is chosen and it isn't using the writing canvas.
const templated = computed(() => hasTemplate.value && !!data.preset && !showBody.value);

const slotsData = computed(() => (data.slots as Record<string, unknown>) ?? {});

// ── field grouping ──────────────────────────────────────────────────────────
// Title + draft are in the chrome; preset + slots are the Template surface. SEO/
// meta collapse into their own disclosure; whatever's left is "details".
const CHROME = new Set(["title", "draft", "preset", "slots"]);
const SEO = new Set(["seo", "description", "featuredImage"]);
const seoFields = computed<Field[]>(() =>
  props.collection.fields.filter((f) => SEO.has(f.name)),
);
const detailFields = computed<Field[]>(() =>
  props.collection.fields.filter((f) => !CHROME.has(f.name) && !SEO.has(f.name)),
);

function goPublish() {
  router.push("/publish");
}

// Saving commits to staging → the "to publish" count changes; keep it honest.
// A slug change renamed the file, so point the URL at the new slug (an existing
// entry only — a brand-new entry stays on its route until the user navigates).
function onSaved() {
  clearError();
  refreshPending(props.client);
  const saved = effectiveSlug.value;
  if (props.path && route.params.slug !== saved) {
    router.replace(entryRoute(props.collection.name, props.locale, saved));
  }
}

onMounted(async () => {
  refreshPending(props.client);
  if (hasTemplate.value) {
    templatesLoading.value = true;
    try {
      templates.value = await listTemplates(props.client);
    } catch (e) {
      reportError(e, "Couldn't load templates.");
    } finally {
      templatesLoading.value = false;
    }
  }
});
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
        <!-- Pending: saved-to-staging but not yet published. Click → the Publish pane. -->
        <button
          v-if="pendingCount"
          class="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
          :title="`${pendingCount} change${pendingCount === 1 ? '' : 's'} saved to staging, not yet published`"
          @click="goPublish"
        >
          <span class="size-1.5 rounded-full bg-amber-500" />
          {{ pendingCount }} to publish
        </button>

        <!-- Draft ⟷ Ready. Off = draft (hidden from the live site); on = will go
             public on the next publish. Saving only commits to staging, so this is
             intent, not "live". -->
        <label class="flex cursor-pointer items-center gap-2 text-sm">
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
          <span :class="data.draft === false ? 'font-medium text-emerald-700' : 'text-zinc-500'">
            {{ data.draft === false ? "Ready" : "Draft" }}
          </span>
        </label>

        <SaveButton
          :action="save"
          :disabled="loading"
          @saved="onSaved"
          @error="(e) => reportError(e, 'Save failed.')"
        />
      </div>
    </header>

    <!-- ── Templated page ─────────────────────────────────────────────────
         Full-width title + URL, then a 2-column band (template fields | live
         preview, preview stretched to the fields' height), then the page's
         vital-info fields in a single column below. -->
    <main
      v-if="templated"
      class="flex flex-1 justify-center px-5 pt-10 pb-24"
      @input="markDirty"
      @change="markDirty"
    >
      <div class="flex w-full max-w-[100rem] flex-col gap-6">
        <!-- Title + editable URL/slug -->
        <div class="flex flex-col gap-2">
          <input
            v-model="data.title"
            class="block w-full border-none bg-transparent font-serif text-4xl font-bold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300"
            :placeholder="`${collection.labelSingular} title`"
            @input="markDirty"
          />
          <SlugField
            v-if="isHome"
            model-value=""
            prefix="/"
            suffix=""
            :editable="false"
          />
          <SlugField
            v-else
            v-model="slug"
            :prefix="urlPrefix"
            :suffix="urlSuffix"
            :placeholder="slugPlaceholder"
            :label="isPages ? 'URL' : 'Slug'"
          />
        </div>

        <!-- Template fields | live preview -->
        <div class="grid gap-8 lg:grid-cols-[26rem_minmax(0,1fr)]">
          <TemplateEditor
            class="min-w-0"
            :client="client"
            :data="data"
            :locale="locale"
            :templates="templates"
            :loading="templatesLoading"
          />
          <PreviewPane
            class="min-w-0"
            :client="client"
            :preset="(data.preset as string)"
            :slots="slotsData"
          />
        </div>

        <!-- Page vital info (single column) -->
        <div class="flex flex-col gap-4">
          <details v-if="seoFields.length" class="card p-4">
            <summary class="cursor-pointer text-sm font-semibold text-zinc-900">
              SEO &amp; metadata
            </summary>
            <div class="mt-3 border-t border-[var(--border)] pt-4">
              <FieldForm :fields="seoFields" :data="data" :client="client" :locale="locale" dense />
            </div>
          </details>
          <details v-if="detailFields.length" class="card p-4">
            <summary class="cursor-pointer text-sm font-semibold text-zinc-900">
              More details
            </summary>
            <div class="mt-3 border-t border-[var(--border)] pt-4">
              <FieldForm :fields="detailFields" :data="data" :client="client" :locale="locale" dense />
            </div>
          </details>
        </div>
      </div>
    </main>

    <!-- ── Writing canvas + details rail (posts, plain pages) ─────────────── -->
    <main v-else class="flex flex-1 justify-center px-5 pt-10 pb-24">
      <div class="flex w-full max-w-[90rem] flex-col gap-8 lg:flex-row lg:items-start">
        <!-- Writing canvas -->
        <div class="w-full min-w-0 lg:max-w-5xl lg:flex-1">
          <div v-if="loading" class="editor-paper w-full">
            <div class="skeleton mb-8 h-12 w-3/4" />
            <div class="skeleton mb-3 h-4 w-full" />
            <div class="skeleton mb-3 h-4 w-11/12" />
            <div class="skeleton h-4 w-4/5" />
          </div>
          <div v-else class="editor-paper w-full">
            <Toolbar
              v-if="editorRef?.editor"
              :editor="editorRef.editor"
              :on-link="editorRef.link"
            />
            <input
              v-model="data.title"
              class="mx-auto block w-full max-w-[46rem] border-none bg-transparent font-serif text-5xl font-bold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300"
              :placeholder="`${collection.labelSingular} title`"
              @input="markDirty"
            />
            <div class="mx-auto mb-6 mt-2 w-full max-w-[46rem]" @input="markDirty">
              <SlugField
                v-if="isHome"
                model-value=""
                prefix="/"
                suffix=""
                :editable="false"
              />
              <SlugField
                v-else
                v-model="slug"
                :prefix="urlPrefix"
                :suffix="urlSuffix"
                :placeholder="slugPlaceholder"
                :label="isPages ? 'URL' : 'Slug'"
              />
            </div>
            <Editor ref="editorRef" :initial-html="bodyHtml" :client="client" @change="markDirty" />
          </div>
        </div>

        <!-- Details rail: Template picker (pages) first, then SEO + details. -->
        <aside
          class="w-full shrink-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:w-[23rem] lg:overflow-y-auto rail-scroll"
          @input="markDirty"
          @change="markDirty"
        >
          <TemplateEditor
            v-if="hasTemplate && !loading"
            :client="client"
            :data="data"
            :locale="locale"
            :templates="templates"
            :loading="templatesLoading"
            class="mb-4"
          />
          <details v-if="!loading && seoFields.length" class="card mb-4 p-4" open>
            <summary class="cursor-pointer text-sm font-semibold text-zinc-900">
              SEO &amp; metadata
            </summary>
            <div class="mt-3 border-t border-[var(--border)] pt-4">
              <FieldForm :fields="seoFields" :data="data" :client="client" :locale="locale" dense />
            </div>
          </details>
          <div class="card p-4">
            <h2 class="mb-3 border-b border-[var(--border)] pb-3 text-sm font-semibold text-zinc-900">
              {{ collection.labelSingular }} details
            </h2>
            <div v-if="loading" class="space-y-4">
              <div class="skeleton h-4 w-24" />
              <div class="skeleton h-9 w-full" />
              <div class="skeleton h-4 w-24" />
              <div class="skeleton h-9 w-full" />
            </div>
            <FieldForm
              v-else
              :fields="detailFields"
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
