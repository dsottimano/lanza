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
import { computed, onMounted, ref, useTemplateRef, watchEffect } from "vue";
import { useRouter, useRoute } from "vue-router";
import Editor from "../editor/Editor.vue";
import Toolbar from "../editor/Toolbar.vue";
import FieldForm from "../fields/FieldForm.vue";
import TemplateEditor from "./TemplateEditor.vue";
import PreviewPane from "./PreviewPane.vue";
import SlugField from "./SlugField.vue";
import EntryLocaleBar from "./EntryLocaleBar.vue";
import ChangeList from "./ChangeList.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient } from "../backend/github";
import { type FolderCollection, type Field } from "../schema";
import type { Locale } from "../backend/config";
import { listTemplates, type TemplateInfo } from "../backend/templates";
import { toEditorHtml } from "../backend/markdown";
import { slugify } from "../backend/slug";
import { entryPathFrame } from "../backend/site-urls";
import { stemOf, takeTranslationSeed } from "../backend/translations";
import { entryRoute } from "../router";
import { reportError, clearError } from "../errors";
import { useEntryEditor } from "./useEntryEditor";
import { useEntryReview } from "./useEntryReview";
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
const originalSlug = stemOf(props.path);
// A new entry started from the locale bar arrives with the source entry's stem in
// the query. It has to keep it: translations are linked BY the shared filename, so a
// different slug here means the two files are not the same entry to the build.
const seededSlug = typeof route.query.slug === "string" ? route.query.slug : "";
const slug = ref(originalSlug || seededSlug);
// The stem the locale bar matches translations on: the entry as it stands on the
// branch, deliberately NOT the slug being typed — a lookup per keystroke would be a
// request per keystroke. A rename re-routes and remounts this editor, which is when
// it refreshes.
const entryStem = originalSlug || seededSlug;
// "home" is the site root (→ `/`); renaming it would break the root, so it's locked.
const isHome = computed(() => props.collection.name === "pages" && originalSlug === "home");
const slugPlaceholder = computed(() => slugify(String(data.title ?? "")));
// The slug actually saved (matches useEntryEditor): typed → slugified, else title.
const effectiveSlug = computed(() =>
  slug.value.trim() ? slugify(slug.value) : slugPlaceholder.value,
);
// Public URL framing. The path rules (which collection sits where, which locales get
// a /es prefix, and that "home" IS the root) live in ONE place — backend/site-urls,
// the same module the list's View links use — so the line under the title shows the
// address the entry will actually have, prefix and all, not a bare slug. A collection
// with no public page has no frame: its slug is only a filename, and saying "URL"
// about it would be a promise the site can't keep.
const urlFrame = computed(() =>
  entryPathFrame(
    props.collection.name,
    isHome.value ? originalSlug : effectiveSlug.value,
    props.locale,
  ),
);
const urlPrefix = computed(() => urlFrame.value?.prefix ?? "");
const urlSuffix = computed(() => urlFrame.value?.suffix ?? "");
const urlLabel = computed(() => (urlFrame.value ? "URL" : "Slug"));

// Frontmatter lives in `data`; the body is the live editor HTML, read at save.
// `dirty`/`markDirty` are the shared unsaved-changes signal (see useEntryEditor).
const { data, loading, save, dirty, markDirty } = useEntryEditor(props, {
  onLoaded: (body, isNew) => {
    if (isNew) {
      // Started from the locale bar? Take the parked shell — the template and its
      // empty slots, never the source language's words (backend/translations.ts).
      const shell = takeTranslationSeed(props.collection.name, props.locale, slug.value);
      if (shell) Object.assign(data, shell);
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

// ── review: what publishing this entry would change ─────────────────────────
// Increasingly these are an AGENT's edits, so the owner's job is judging them
// rather than typing them. The panel lists the changed fields; the preview shows
// WHERE each one is. Selection runs both ways — click a row to find it on the page,
// click the page to find it in the list.
const previewRef = useTemplateRef<InstanceType<typeof PreviewPane>>("previewRef");

const review = useEntryReview({
  client: props.client,
  path: () => props.path,
  data,
  getBody: () => editorRef.value?.getHTML() ?? bodyHtml.value,
  setBody: (html) => {
    bodyHtml.value = html;
    // The canvas is a live TipTap instance when it is mounted; setting the ref alone
    // would leave the editor showing the text it just replaced.
    editorRef.value?.editor?.commands.setContent(html);
  },
  markDirty,
});

function onRowSelect(path: string): void {
  review.select(path);
  previewRef.value?.scrollToField(path);
}

function onPreviewSelect(path: string): void {
  review.select(path);
}

function onRevert(path: string): void {
  if (review.revert(path)) previewRef.value?.scrollToField(path);
}

// One highlighted region at a time once a row is picked; before that, every pending
// change is lit, so opening an entry an agent edited SHOWS the edits rather than
// requiring a click to discover them.
watchEffect(() => {
  const preview = previewRef.value;
  if (!preview) return;
  preview.highlight(review.selected.value ? [review.selected.value] : review.changed.value);
});

// Saving commits to staging → the "to publish" count changes; keep it honest.
// A slug change renamed the file, so point the URL at the new slug (an existing
// entry only — a brand-new entry stays on its route until the user navigates).
function onSaved() {
  clearError();
  refreshPending(props.client);
  // Re-take the diff: what is pending has just changed, and a stale report would
  // offer to revert a field to a value that is no longer what the live site says.
  // This is also what keeps array paths valid across two reverts (entry-diff notes
  // the case where reverting one added item shifts another).
  review.load();
  const saved = effectiveSlug.value;
  if (props.path && route.params.slug !== saved) {
    router.replace(entryRoute(props.collection.name, props.locale, saved));
  }
}

onMounted(async () => {
  refreshPending(props.client);
  review.load();
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
        <!-- Language, then title + editable URL/slug — in a card, like every other
             panel on this screen. They used to float loose above the Template card,
             which read as chrome rather than as the page's first two fields. -->
        <div class="card flex flex-col gap-2 p-4">
          <EntryLocaleBar
            :client="client"
            :collection="collection"
            :locale="locale"
            :slug="entryStem"
            :data="data"
          />
          <label class="block">
            <span class="block text-xs font-semibold text-zinc-600">Title</span>
            <input
              v-model="data.title"
              class="mt-1 block w-full border-none bg-transparent font-serif text-3xl font-bold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300"
              :placeholder="`${collection.labelSingular} title`"
              @input="markDirty"
            />
          </label>
          <SlugField
            v-if="isHome"
            model-value=""
            :prefix="urlPrefix"
            :suffix="urlSuffix"
            :editable="false"
          />
          <SlugField
            v-else
            v-model="slug"
            :prefix="urlPrefix"
            :suffix="urlSuffix"
            :placeholder="slugPlaceholder"
            :label="urlLabel"
          />
        </div>

        <!-- Template fields | live preview.
             The form is the tall column and the preview is the reference, so the
             preview STICKS: scrolling to a field three sections down used to carry
             the rendered page off the top of the screen, leaving you editing blind.
             Its own height, its own scroll. -->
        <div class="grid items-start gap-6 lg:grid-cols-[26rem_minmax(0,1fr)]">
          <TemplateEditor
            class="min-w-0"
            :client="client"
            :data="data"
            :locale="locale"
            :templates="templates"
            :loading="templatesLoading"
            :changed="review.changed.value"
          />
          <!-- `body` is a RESERVED ROOT key, a sibling of the slots, exactly as the
               build assembles it (frontend/components/PageArticle.astro). Without it
               a {{{ body }}} template previewed as an empty article — the preview was
               never given the body at all. -->
          <PreviewPane
            ref="previewRef"
            class="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]"
            :client="client"
            :preset="(data.preset as string)"
            :slots="slotsData"
            :body="bodyHtml"
            @select="onPreviewSelect"
          />
        </div>

        <!-- Page vital info (single column) -->
        <div class="flex flex-col gap-4">
          <!-- What publishing would change. Above the disclosures because it is the
               first question about a page someone else — or something else — edited. -->
          <ChangeList
            v-if="review.hasChanges.value"
            :diff="review.diff.value!"
            :fields="collection.fields"
            @select="onRowSelect"
            @revert="onRevert"
          />
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
            <div class="mx-auto mb-3 w-full max-w-[46rem]">
              <EntryLocaleBar
                :client="client"
                :collection="collection"
                :locale="locale"
                :slug="entryStem"
                :data="data"
              />
            </div>
            <label class="mx-auto block w-full max-w-[46rem]">
              <span class="block text-xs uppercase tracking-wide text-zinc-400">Title</span>
              <input
                v-model="data.title"
                class="mt-1 block w-full border-none bg-transparent font-serif text-5xl font-bold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300"
                :placeholder="`${collection.labelSingular} title`"
                @input="markDirty"
              />
            </label>
            <div class="mx-auto mb-6 mt-2 w-full max-w-[46rem]" @input="markDirty">
              <SlugField
                v-if="isHome"
                model-value=""
                :prefix="urlPrefix"
                :suffix="urlSuffix"
                :editable="false"
              />
              <SlugField
                v-else
                v-model="slug"
                :prefix="urlPrefix"
                :suffix="urlSuffix"
                :placeholder="slugPlaceholder"
                :label="urlLabel"
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
          <!-- Same panel as the templated shape, at the top of the rail: on a post,
               "what would publishing change" is still the first question. There is no
               preview here to point at, so selecting a row only marks it. -->
          <ChangeList
            v-if="review.hasChanges.value"
            :diff="review.diff.value!"
            :fields="collection.fields"
            class="mb-4"
            @select="onRowSelect"
            @revert="onRevert"
          />
          <TemplateEditor
            v-if="hasTemplate && !loading"
            :client="client"
            :data="data"
            :locale="locale"
            :templates="templates"
            :loading="templatesLoading"
            :changed="review.changed.value"
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
