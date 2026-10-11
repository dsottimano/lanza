<script setup lang="ts">
// Entry editor for posts + pages. Two shapes, chosen by whether the page actually
// uses its rich body:
//   • Templated page (a `preset` whose template doesn't render {{{ body }}}) → the
//     writing canvas is dead weight, so it's hidden. Instead: Template picker +
//     slot fields on the left, a LIVE PREVIEW of the rendered template on the right.
//   • Everything else (posts, plain pages, body-using templates) → the writing
//     canvas stays the centre of gravity with a details rail beside it.
// Shared chrome offers Save and an explicit save-to-review publication action.
import { publicSlug } from "../backend/site-urls";
import { saveUrlChange } from "../backend/url-changes";
import { isOwner } from "../backend/access";
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch, watchEffect } from "vue";
import { useRouter, useRoute } from "vue-router";
import Editor from "../editor/Editor.vue";
import Toolbar from "../editor/Toolbar.vue";
import FieldForm from "../fields/FieldForm.vue";
import TemplateEditor from "./TemplateEditor.vue";
import PreviewPane from "./PreviewPane.vue";
import SlugField from "./SlugField.vue";
import IdentityField from "./IdentityField.vue";
import { site } from "../backend/site";
import EntryLocaleBar from "./EntryLocaleBar.vue";
import ChangeList from "./ChangeList.vue";
import { useWritingPreferences } from "./writing-preferences";
import WritingPanel from "./WritingPanel.vue";
import { GitHubClient } from "../backend/github";
import { type FolderCollection, type Field } from "../schema";
import type { Locale } from "../backend/config";
import { listTemplates, type TemplateInfo } from "../backend/templates";
import { toEditorHtml } from "../backend/markdown";
import { slugify } from "../backend/slug";
import { entryPathFrame } from "../backend/site-urls";
import { stemOf, takeTranslationSeed } from "../backend/translations";
import { reportError, clearError } from "../errors";
import { useEntryEditor } from "./useEntryEditor";
import { useEditorSiteTools } from "./useEditorSiteTools";
import { fieldRecords } from "../../../frontend/lib/provenance/text.mjs";
import { bodyContext, prepareBodyProposal, type BodyTarget } from "../editor/body-proposal";
import AgentBodyReview from "./AgentBodyReview.vue";
import AgentRequests from "./AgentRequests.vue";
import { prepareRequestReplacement, type RequestAnchor } from "../backend/agent-requests";
import { access } from "../backend/access";
import { pluginRequest } from "../backend/plugins";
import { useEntryReview } from "./useEntryReview";
import { refreshPending } from "./staging";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
  path: string | null;
}>();
const emit = defineEmits<{ (e: "back"): void; (e: "savedPath", path: string): void }>();

const router = useRouter();
const route = useRoute();
const editorRef = useTemplateRef<InstanceType<typeof Editor>>("editorRef");

const bodyHtml = ref("<p></p>");
const titleInput = ref<HTMLTextAreaElement>();
const pageTitleInput = ref<HTMLInputElement>();
const siteToolsRoot = ref<HTMLElement>();
function growTitle() {
  const el = titleInput.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
const { preferences, focusMode } = useWritingPreferences();
const editorProblem = ref("");
const pagePanel = ref<"content" | "details" | "changes">("content");
const templateEditor = ref<InstanceType<typeof TemplateEditor>>();
const siteToolsField = ref<string | null>(null);
const siteToolsSession = crypto.randomUUID();
const focusFormatting = ref(false);
const bodyReview = ref<{ before: string; after: string; target: BodyTarget } | null>(null);
const requestBusy = ref(false);
let bodyReviewDecision: ((accepted: boolean) => void) | null = null;
function finishBodyReview(accepted: boolean) {
  const decision = bodyReviewDecision;
  bodyReviewDecision = null;
  bodyReview.value = null;
  decision?.(accepted);
}
onUnmounted(() => finishBodyReview(false));
onMounted(() => window.addEventListener("resize", growTitle));
onUnmounted(() => window.removeEventListener("resize", growTitle));
const saveLabel = computed(() => {
  if (loading.value || templatesLoading.value) return "Loading…";
  if (loadFailed.value) return "Couldn't load entry";
  if (saving.value) return "Saving…";
  if (saveError.value) return "Not saved";
  if (dirty.value) return !String(data.title ?? "").trim() ? "Add a title to autosave" : "Unsaved changes";
  return savedAt.value ? "Saved to drafts" : "Autosave on";
});
async function saveNow() {
  try { await save(); } catch (e) { reportError(e, "Save failed."); }
}


// ── slug / URL ────────────────────────────────────────────────────────────
// Pages and posts keep a stable filename to link translations. Public slugs are
// separate, per-language settings saved together with permanent redirects.
const publicUrlEditing = ["pages", "posts"].includes(props.collection.name);
const originalSlug = stemOf(props.path);
// A new entry started from the locale bar arrives with the source entry's stem in
// the query. It has to keep it: translations are linked BY the shared filename, so a
// different slug here means the two files are not the same entry to the build.
const seededSlug = typeof route.query.slug === "string" ? route.query.slug : "";
const slug = ref(originalSlug || seededSlug ? publicSlug(props.collection.name, originalSlug || seededSlug, props.locale) : "");
const savedSlug = ref(slug.value);
// The stem the locale bar matches translations on: the entry as it stands on the
// branch, deliberately NOT the slug being typed — a lookup per keystroke would be a
// request per keystroke. A rename re-routes and remounts this editor, which is when
// it refreshes.
const entryStem = computed(() => stemOf(currentPath.value) || seededSlug);
// An empty homepage slug means this language’s root URL.
const isHome = computed(() => props.collection.name === "pages" && (originalSlug === "home" || seededSlug === "home"));
const slugPlaceholder = computed(() => isHome.value ? "" : slugify(String(data.title ?? "")));
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
    effectiveSlug.value,
    props.locale,
  ),
);
const urlPrefix = computed(() => urlFrame.value?.prefix ?? "");
const urlSuffix = computed(() => urlFrame.value?.suffix ?? "");
const agentRequestsRef = ref<InstanceType<typeof AgentRequests>>();
const translationPreparing = ref(false);
const translationIssue = ref("");
async function askForTranslation(code: Locale, label: string) {
  if (translationPreparing.value) return;
  translationPreparing.value = true; translationIssue.value = "";
  try {
    if (dirty.value || saving.value || !currentPath.value) await save();
    await nextTick();
    if (dirty.value || saveError.value || !currentPath.value) throw new Error(saveError.value || "The article changed while saving. Save your latest edits, then request the translation again.");
    const opened = await agentRequestsRef.value?.requestTranslation(code, label);
    if (!opened) throw new Error("The translation request could not open. Finish any open review and resolve the editor's save notice, then try again.");
  } catch (reason) { translationIssue.value = reason instanceof Error ? reason.message : "Could not prepare the translation request. Try again."; }
  finally { translationPreparing.value = false; }
}
const languageLabel = computed(() => site.locales.find(language => language.code === props.locale)?.label ?? props.locale);
const urlLabel = computed(() => urlFrame.value
  ? (props.collection.localized ? `${languageLabel.value} URL` : "URL") : "Slug");

// Frontmatter lives in `data`; the body is the live editor HTML, read at save.
// `dirty`/`markDirty` are the shared unsaved-changes signal (see useEntryEditor).
const { data, loading, loadFailed, saving, deleting, deleteEntry, saveError, savedAt, pauseReason,
  recovery, localCopy, currentPath, save, dirty, markDirty, pauseAutosave,
  restoreRecovery, discardRecovery, getRevision, getBaseSha } = useEntryEditor(props, {
  autosave: true,
  onSaved,
  restore: (body, restoredSlug) => {
    slug.value = restoredSlug;
    bodyHtml.value = body;
    editorRef.value?.editor?.commands.setContent(body);
  },
  onLoaded: (body, isNew) => {
    if (isNew) {
      // Started from the locale bar? Take the parked shell — the template and its
      // empty slots, never the source language's words (backend/translations.ts).
      const shell = takeTranslationSeed(props.collection.name, props.locale, seededSlug);
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
  getSlug: () => slug.value,
  getStorageSlug: () => publicUrlEditing ? entryStem.value || effectiveSlug.value : slug.value,
  urlChanged: () => publicUrlEditing && !!currentPath.value && effectiveSlug.value !== savedSlug.value,
  saveEntry: async (path, snapshot, body, sha) => {
    const nextSlug = effectiveSlug.value;
    const stem = stemOf(path);
    const previous = publicSlug(props.collection.name, stem, props.locale);
    if (publicUrlEditing && (nextSlug !== previous || !sha)) {
      const result = await saveUrlChange(props.client, { collection: props.collection.name,
        locale: props.locale, stem, slug: nextSlug, previousSlug: currentPath.value ? savedSlug.value : previous,
        path, sha, data: snapshot, body });
      savedSlug.value = nextSlug;
      return result;
    }
    const result = await props.client.saveEntry(path, snapshot, body, `lanza: save ${path}`, sha);
    savedSlug.value = nextSlug;
    return result;
  },
});

const deleteError = ref("");
let editorActive = true;
onUnmounted(() => { editorActive = false; });
const canDelete = computed(() => access.loaded && (access.role === "owner" || access.role === "editor") && !!currentPath.value);
async function deleteCurrentEntry() {
  if (!canDelete.value || deleting.value || saving.value || preparingPublication.value || editorLoading.value || loadFailed.value || recovery.value || bodyReview.value || requestBusy.value) return;
  const unsaved = dirty.value ? " Your unsaved changes will also be discarded." : "";
  if (!window.confirm(`Delete "${String(data.title || props.collection.labelSingular)}" (${props.locale})?${unsaved} This removes only this entry from drafts. The live site changes only after Review & publish.`)) return;
  deleteError.value = "";
  try {
    await deleteEntry();
    void refreshPending(props.client);
    if (editorActive) emit("back");
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : "Deletion failed. Your writing is still here.";
  }
}

const title = computed({ get: () => String(data.title ?? ""), set: (value: string) => { data.title = value; } });
watch([() => data.title, titleInput], () => nextTick(growTitle), { flush: "post" });

// ── templates: one load feeds the picker, the show-body decision + the preview ──
const templates = ref<TemplateInfo[]>([]);
const templatesLoading = ref(props.collection.fields.some((field) => field.name === "preset"));
const editorLoading = computed(() => loading.value || templatesLoading.value);

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

watchEffect(() => { if (templated.value) focusMode.value = false; });

const slotsData = computed(() => (data.slots as Record<string, unknown>) ?? {});

useEditorSiteTools({
  data,
  fields: () => props.collection.fields.map(field => field.widget === "slots"
    ? { ...field, widget: "object", fields: selectedTemplate.value?.fields ?? [] } : field),
  context: () => ({ repository: access.repo, collection: props.collection.name, locale: props.locale,
    path: currentPath.value, selectedField: siteToolsField.value, dirty: dirty.value, baseSha: getBaseSha() }),
  revision: () => `${siteToolsSession}:${getRevision()}:${getBaseSha() ?? "new"}:${editorRef.value?.editor?.state.selection.from ?? "none"}:${editorRef.value?.editor?.state.selection.to ?? "none"}`,
  ready: () => access.loaded && !editorLoading.value && !loadFailed.value && !saving.value && !deleting.value && !recovery.value && !saveError.value && !editorProblem.value && !requestBusy.value,
  canEdit: () => access.loaded && (access.role === "owner" || access.role === "editor"),
  pauseAutosave,
  body: {
    available: () => showBody.value && !!editorRef.value?.editor && !editorProblem.value,
    context: () => bodyContext(editorRef.value!.editor!),
    prepare: (target, html) => prepareBodyProposal(editorRef.value!.editor!, target, html),
    focus: () => { editorRef.value?.focus(); return !!editorRef.value?.editor; },
    review: proposal => {
      if (bodyReviewDecision) throw new Error("Review or cancel the current body proposal first.");
      bodyReview.value = proposal;
      return new Promise<boolean>(resolve => { bodyReviewDecision = resolve; });
    },
  },
  focus: async path => {
    focusMode.value = false;
    if (path === "title") {
      if (templated.value) pagePanel.value = "details";
      await nextTick();
      const input = templated.value ? pageTitleInput.value : titleInput.value;
      input?.focus(); siteToolsField.value = path;
      return !!input;
    }
    pagePanel.value = "content";
    preferences.options = true;
    await nextTick();
    if (await templateEditor.value?.focusField(path)) { onFocusField(path); return true; }
    if (templated.value) { pagePanel.value = "details"; await nextTick(); }
    // Generic metadata fields retain their ordinary DOM/input behavior. Matching
    // an attribute value avoids interpreting an agent path as a CSS selector.
    const node = [...(siteToolsRoot.value?.querySelectorAll<HTMLElement>("[data-field-path]") ?? [])]
      .find(element => element.dataset.fieldPath === path);
    const input = node?.querySelector<HTMLElement>("input,textarea,select");
    if (!input) return false;
    for (let ancestor = input.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === "DETAILS") (ancestor as HTMLDetailsElement).open = true;
    }
    input.focus(); onFocusField(path); return true;
  },
});

async function reviewRequestReplacement(anchor: RequestAnchor, html: string): Promise<boolean> {
  const ready = () => editorActive && isOwner() && !editorLoading.value && !loadFailed.value && !saving.value && !deleting.value && !recovery.value && !saveError.value && !editorProblem.value;
  if (!ready() || bodyReviewDecision || !editorRef.value?.editor) throw new Error("Finish the current editor operation before reviewing a response.");
  const editor = editorRef.value.editor;
  const path = currentPath.value;
  const baseSha = getBaseSha();
  const proposal = await prepareRequestReplacement(editor, anchor, html);
  if (!ready() || currentPath.value !== path || getBaseSha() !== baseSha || bodyReviewDecision) throw new Error("The editor changed. Review the response again.");
  bodyReview.value = { before: proposal.before, after: proposal.after, target: "selection" };
  const accepted = await new Promise<boolean>(resolve => { bodyReviewDecision = resolve; });
  if (!accepted) return false;
  if (!ready() || currentPath.value !== path || getBaseSha() !== baseSha) throw new Error("The editor changed during review. Nothing was applied.");
  if (!proposal.changed) return false;
  pauseAutosave("Accepted an agent response in your editor. Save to keep the draft and resume autosave.");
  proposal.apply();
  return true;
}

// A research proposal is reviewed against the current document, never written by
// the collector. The editor's normal transaction guard and undo remain in force.
const researchIssue = ref("");
async function reviewResearchFacts() {
  const ready = () => editorActive && isOwner() && !editorLoading.value && !loadFailed.value && !saving.value && !deleting.value && !recovery.value && !saveError.value && !editorProblem.value;
  if (!ready() || bodyReviewDecision || requestBusy.value || !editorRef.value?.editor || !currentPath.value) return;
  const editor = editorRef.value.editor, path = currentPath.value, baseSha = getBaseSha();
  const originalDoc = editor.state.doc;
  requestBusy.value = true; researchIssue.value = "";
  try {
    const archive = await pluginRequest("research");
    if (archive.state.data?.manifest?.article.contentPath !== path) throw new Error("Configure Research for this article in Plugins first.");
    const facts = await pluginRequest("research", "propose", { expectedSha: archive.sha });
    if (!ready() || currentPath.value !== path || getBaseSha() !== baseSha || editor.state.doc !== originalDoc || bodyReviewDecision) throw new Error("The article changed. Review the facts again.");
    // Selected text is replaced; otherwise facts are appended. The review shows
    // the complete before/after article and requires a deliberate acceptance.
    const target: BodyTarget = editor.state.selection.empty ? "body" : "selection";
    const proposal = prepareBodyProposal(editor, target, target === "body" ? editor.getHTML() + "<h2>Research facts</h2>" + facts.html : facts.html);
    bodyReview.value = { before: proposal.before, after: proposal.after, target };
    const accepted = await new Promise<boolean>(resolve => { bodyReviewDecision = resolve; });
    if (!accepted) return;
    const latest = await pluginRequest("research");
    if (!ready() || currentPath.value !== path || getBaseSha() !== baseSha || latest.sha !== archive.sha || !latest.state.enabled) throw new Error("The article or research changed during review. Nothing was applied.");
    pauseAutosave("Accepted research facts in your editor. Save to keep the draft and resume autosave.");
    proposal.apply();
  } catch (error) { researchIssue.value = error instanceof Error ? error.message : "Could not review research facts."; }
  finally { requestBusy.value = false; }
}

// ── field grouping ──────────────────────────────────────────────────────────
// Title is in the chrome; preset + slots are the Template surface. SEO/
// meta collapse into their own disclosure; whatever's left is "details".
const CHROME = new Set(["title", "preset", "slots"]);
const SEO = new Set(["seo", "description", "featuredImage"]);
const seoFields = computed<Field[]>(() =>
  props.collection.fields.filter((f) => SEO.has(f.name)),
);
const detailFields = computed<Field[]>(() =>
  props.collection.fields.filter((f) => !CHROME.has(f.name) && !SEO.has(f.name))
    .map(f => f.name === "draft" ? { ...f, label: "Keep unpublished" } : f),
);

const summaryOpen = ref(true);
const detailsExpanded = ref(false);
const summaryFields = computed(() => seoFields.value.filter(f => f.name !== "seo"));
const searchFields = computed(() => seoFields.value.filter(f => f.name === "seo").map(f => ({ ...f,
  fields: f.fields?.filter(child => ["metaTitle", "metaDescription", "ogImage"].includes(child.name)).map(child => ({ ...child,
    label: ({ metaTitle: "Search title", metaDescription: "Search description", ogImage: "Social sharing image" } as Record<string, string>)[child.name] ?? child.label,
  })),
})));
const advancedSearchFields = computed(() => seoFields.value.filter(f => f.name === "seo").map(f => ({ ...f,
  fields: f.fields?.filter(child => !["metaTitle", "metaDescription", "ogImage"].includes(child.name)),
})));
const writingDetailFields = computed(() => detailFields.value.filter(f => !["updatedDate", "template"].includes(f.name)));

const preparingPublication = ref(false);
async function reviewAndPublish() {
  if (!isOwner() || preparingPublication.value || saving.value || deleting.value || editorLoading.value || loadFailed.value || recovery.value || editorProblem.value || bodyReview.value || requestBusy.value) return;
  preparingPublication.value = true;
  try {
    pauseAutosave("Preparing this entry for publication review.");
    if (props.collection.fields.some(field => field.name === "draft")) data.draft = false;
    markDirty();
    await save();
    if (dirty.value) {
      pauseAutosave("The entry changed while saving. Review your latest edits, then choose Review & publish again.");
      return;
    }
    await router.push("/publish");
  } catch (error) {
    reportError(error, "Could not save this entry for publication review.");
  } finally {
    preparingPublication.value = false;
  }
}

// ── review: what publishing this entry would change ─────────────────────────
// Increasingly these are an AGENT's edits, so the owner's job is judging them
// rather than typing them. The panel lists the changed fields; the preview shows
// WHERE each one is. Selection runs both ways — click a row to find it on the page,
// click the page to find it in the list.
const previewRef = useTemplateRef<InstanceType<typeof PreviewPane>>("previewRef");

const review = useEntryReview({
  client: props.client,
  path: () => currentPath.value,
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

async function onPreviewSelect(path: string): Promise<void> {
  siteToolsField.value = path;
  review.select(path);
  pagePanel.value = "content";
  await nextTick();
  await templateEditor.value?.focusField(path);
}

// Focusing a field brings its region into view. This is the answer to "the form and
// the preview don't line up": with 28 slots in a tall column, whatever the preview
// happened to be showing beside them was unrelated to what you were typing.
// scrollToField declines to move for a field the template doesn't place, so tabbing
// through SEO fields leaves the page where it is rather than jumping to the top.
function onFocusField(path: string): void {
  siteToolsField.value = path;
  if (templated.value) review.select(path);
  previewRef.value?.scrollToField(path);
}

function onRevert(path: string): void {
  pauseAutosave("Reverted in your editor. Save to keep this change and resume autosaving.");
  if (review.revert(path)) previewRef.value?.scrollToField(path);
}

// Keep content editing quiet; the Changes panel reveals all pending edits.
// A selected review row or field highlights only the region being inspected.
watchEffect(() => {
  const preview = previewRef.value;
  if (!preview) return;
  preview.highlight(review.selected.value ? [review.selected.value] : pagePanel.value === "changes" ? review.changed.value : []);
});

// Saving commits to staging → the "to publish" count changes; keep it honest.
// A slug change renamed the file, so point the URL at the new slug (an existing
// entry only — a brand-new entry stays on its route until the user navigates).
function onSaved(path: string) {
  clearError();
  // Pin a new entry's URL after its first save. Editing its title must not rename it.
  if (!slug.value && !isHome.value) slug.value = savedSlug.value;
  refreshPending(props.client);
  review.load();
  // The shell updates the address while retaining this editor instance.
  if (!dirty.value && path !== props.path) emit("savedPath", path);
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
  <div ref="siteToolsRoot" class="writing-workspace flex min-h-screen flex-col" :class="{ 'writing-workspace--focus': focusMode && !templated && !editorLoading, 'page-editing-workspace': templated || (editorLoading && hasTemplate) }">
    <AgentBodyReview v-if="bodyReview" v-bind="bodyReview" @decision="finishBodyReview" />
    <header class="toolbar writing-header flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <button
        class="text-sm text-zinc-600 transition hover:text-zinc-900"
        :disabled="deleting" @click="emit('back')"
      >
        ← {{ collection.label }}
      </button>

      <span class="writing-save-status text-xs text-zinc-500" role="status" aria-live="polite">
        {{ saveLabel }}
      </span>

      <div class="flex flex-wrap items-center gap-3">
        <button v-if="!editorLoading && !templated" type="button" class="btn btn-ghost" :aria-pressed="focusMode"
          @click="focusMode = !focusMode">{{ focusMode ? "Exit focus" : "Focus" }}</button>
        <button v-if="!editorLoading && !templated && !focusMode" type="button" class="btn btn-ghost"
          :aria-expanded="preferences.options" aria-controls="writing-options"
          @click="preferences.options = !preferences.options">Details</button>
        <button v-if="canDelete" type="button" class="btn btn-ghost text-red-700"
          :disabled="editorLoading || loadFailed || saving || deleting || preparingPublication || !!recovery || !!bodyReview || requestBusy"
          @click="deleteCurrentEntry">{{ deleting ? 'Deleting…' : `Delete ${collection.labelSingular.toLowerCase()}` }}</button>
        <button type="button" class="btn btn-ghost" :disabled="editorLoading || loadFailed || saving || deleting || preparingPublication || !!recovery || !!editorProblem || !!bodyReview"
          @click="saveNow">{{ saving ? "Saving…" : saveError ? "Retry save" : "Save" }}</button>
        <button v-if="isOwner()" type="button" class="btn btn-primary"
          :disabled="editorLoading || loadFailed || saving || deleting || preparingPublication || !!recovery || !!editorProblem || !!bodyReview || requestBusy"
          title="Save this entry for publication, then review all saved site changes"
          @click="reviewAndPublish">{{ preparingPublication ? "Preparing review…" : "Review & publish" }}</button>
      </div>
    </header>

    <p v-if="deleteError" class="writing-notice" role="alert">Deletion failed: {{ deleteError }} Your writing is still here.</p>
    <div v-if="recovery" class="writing-notice" role="status">
      <p>There is unfinished writing from this tab. Restore it to review and continue, or keep the saved version.</p>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-primary" @click="restoreRecovery">Restore writing</button>
        <button class="btn btn-ghost" @click="discardRecovery">Keep saved version</button>
      </div>
    </div>
    <div v-if="saveError || pauseReason || editorProblem" class="writing-notice" role="status">
      <p>{{ editorProblem || saveError || pauseReason }}</p>
      <p v-if="localCopy" class="text-xs text-zinc-500">A recovery copy is available in this tab.</p>
    </div>
    <div v-if="loadFailed" class="writing-notice" role="alert">
      The entry couldn't be loaded. Reload this page to try again. Saving is disabled to protect the stored content.
    </div>

    <main v-if="editorLoading && !loadFailed && !recovery" class="page-loading" :class="{ 'page-loading--template': hasTemplate }" aria-busy="true" aria-label="Loading editor">
      <div class="page-loading__identity"><div class="skeleton h-10 w-64" /><div class="skeleton h-10 w-48" /></div>
      <div class="page-loading__workspace">
        <div class="page-loading__controls"><div class="skeleton h-8 w-full" /><div class="skeleton h-4 w-32" /><div class="skeleton h-24 w-full" /><div class="skeleton h-24 w-full" /></div>
        <div class="page-loading__preview"><span>Loading {{ collection.labelSingular.toLowerCase() }}…</span></div>
      </div>
    </main>
    <main :inert="deleting" v-else-if="templated && !loadFailed && !recovery" class="page-editor">
      <div class="page-editor-heading">
        <div><p class="page-editor-eyebrow">Page editor</p><h1>{{ title || 'Untitled page' }}</h1><p class="page-editor-address">{{ urlPrefix }}{{ effectiveSlug }}{{ urlSuffix }}</p></div>
        <EntryLocaleBar :client="client" :collection="collection" :locale="locale" :slug="entryStem" :data="data" />
      </div>
      <div class="page-workspace">
        <aside class="page-inspector" aria-label="Page editing controls">
          <div class="page-inspector__tabs" aria-label="Editing panels">
            <button type="button" :aria-pressed="pagePanel === 'content'" @click="pagePanel = 'content'">Content</button>
            <button type="button" :aria-pressed="pagePanel === 'details'" @click="pagePanel = 'details'">Settings</button>
            <button type="button" :aria-pressed="pagePanel === 'changes'" @click="pagePanel = 'changes'">
              Changes<span v-if="review.hasChanges.value" class="page-changes-count">{{ review.changed.value.length }}</span>
            </button>
          </div>
          <div class="page-inspector__body">
            <div v-show="pagePanel === 'content'">
              <p v-if="Object.keys(fieldRecords(data)).length" class="writing-notice">Agent-origin fields are recorded in this entry’s provenance. Human acceptance does not change authorship.</p>
              <p class="page-edit-hint">Choose a section, or click text in the preview to edit it here.</p>
              <TemplateEditor ref="templateEditor" content-only :client="client" :data="data" :locale="locale"
                :templates="templates" :loading="templatesLoading" :changed="review.changed.value" @focus-field="onFocusField" />
            </div>
            <div v-show="pagePanel === 'details'">
              <div class="page-identity">
                <IdentityField label="Page name" class="page-identity__name">
                  <template #default="{ inputId }">
                    <input ref="pageTitleInput" :id="inputId" v-model="title" placeholder="Page name" class="identity-name-input" @focus="siteToolsField = 'title'" />
                  </template>
                </IdentityField>
                <div class="page-identity__url">
                  <SlugField :editable="!publicUrlEditing || !currentPath || isOwner()" v-model="slug" :prefix="urlPrefix" :suffix="urlSuffix" :placeholder="slugPlaceholder"
                    :label="urlLabel" @update:model-value="markDirty" />
                </div>
              </div>
              <p v-if="dirty && effectiveSlug !== savedSlug" class="writing-notice">Save to change this language’s URL. The old URL will redirect here with a 301 after Publish.</p>

              <p class="page-edit-hint">Search appearance and page settings. These are separate from the words shown on the page.</p>
              <FieldForm :fields="seoFields" :data="data" :client="client" :locale="locale" />
              <FieldForm :fields="detailFields" :data="data" :client="client" :locale="locale" />
              <p class="page-template-note">Design: {{ selectedTemplate?.label ?? data.preset }}. Ask your agent to change the layout or structure.</p>
            </div>
            <div v-show="pagePanel === 'changes'">
              <ChangeList v-if="review.hasChanges.value" embedded :selected="review.selected.value" :diff="review.diff.value!" :fields="collection.fields"
                @select="onRowSelect" @revert="onRevert" />
              <p v-else-if="review.loading.value" class="page-edit-hint">Checking page changes…</p>
              <p v-else-if="review.diff.value" class="page-edit-hint">No changes to review for this page.</p>
              <p v-else class="page-edit-hint">Comparison unavailable. Your content is still editable.</p>
            </div>
          </div>
        </aside>
        <PreviewPane ref="previewRef" class="page-preview" :client="client" :preset="(data.preset as string)"
          :locale="locale" :slots="slotsData" :provenance="data.lanzaProvenance" :body="bodyHtml" @select="onPreviewSelect" />
      </div>
    </main>

    <!-- ── Writing canvas + details rail (posts, plain pages) ─────────────── -->
    <main :inert="deleting" v-else-if="!loadFailed && !recovery" class="writing-main flex flex-1 justify-center px-5 pt-8 pb-24">
      <div class="writing-layout" :class="{ 'writing-layout--options': preferences.options && !focusMode, 'writing-layout--expanded': detailsExpanded && preferences.options && !focusMode }">
        <!-- Writing canvas -->
        <div v-show="!(detailsExpanded && preferences.options && !focusMode)" class="writing-document min-w-0">
          <div v-if="loading" class="editor-paper w-full">
            <div class="skeleton mb-8 h-12 w-3/4" />
            <div class="skeleton mb-3 h-4 w-full" />
            <div class="skeleton mb-3 h-4 w-11/12" />
            <div class="skeleton h-4 w-4/5" />
          </div>
          <div v-else class="editor-paper w-full">
            <div class="writing-document-bar">
              <EntryLocaleBar v-if="collection.localized && site.locales.length > 1 && entryStem" :client="client" :collection="collection" :locale="locale" :slug="entryStem" :data="data"
                :request-translation="isOwner()" :locked="deleting || !!bodyReview || loading || !!recovery" @translate="askForTranslation" />
              <span v-else>{{ languageLabel }} <span aria-hidden="true">·</span> {{ collection.labelSingular }}</span>
              <button type="button" class="writing-format-toggle" :aria-expanded="focusFormatting"
                aria-controls="writing-formatting" @click="focusFormatting = !focusFormatting">
                <span aria-hidden="true">Aa</span> {{ focusFormatting ? "Hide formatting" : "Format" }}
              </button>
            </div>
            <p class="writing-notice">Dotted highlights identify agent-written text. Unmarked text has no recorded origin; it is not certified human-written.</p>
            <details v-if="Object.keys(fieldRecords(data)).length" class="writing-notice"><summary>Agent-origin fields</summary><ul><li v-for="(_, path) in fieldRecords(data)" :key="path">{{ path }}</li></ul></details>
            <p v-if="translationPreparing" role="status" class="writing-notice">Saving your latest edits for translation…</p>
            <p v-if="translationIssue" role="alert" class="writing-notice">{{ translationIssue }}</p>
            <div v-if="editorRef?.editor && focusFormatting" id="writing-formatting">
              <Toolbar :editor="editorRef.editor" :on-link="editorRef.link" />
            </div>
            <label class="mx-auto block w-full max-w-[46rem]">
              <span class="sr-only">Title</span>
              <textarea
                ref="titleInput"
                @focus="siteToolsField = 'title'"
                rows="1"
                v-model="title"
                class="writing-title mb-5 resize-none overflow-hidden mt-1 block w-full border-none bg-transparent font-serif font-bold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300"
                :placeholder="`${collection.labelSingular} title`"
                @input="markDirty(); growTitle()"
              />
            </label>
            <AgentRequests ref="agentRequestsRef" :editor="editorRef?.editor" :path="currentPath" :enabled="isOwner()"
              :locked="editorLoading || loadFailed || saving || deleting || preparingPublication || !!recovery || !!editorProblem || !!saveError || !!bodyReview"
              :review-replacement="reviewRequestReplacement" @busy="requestBusy = $event" />
            <div v-if="isOwner() && currentPath && collection.name === 'posts'" class="my-3 text-sm">
              <button type="button" class="btn btn-ghost" :disabled="requestBusy || editorLoading || saving || deleting || preparingPublication || !!recovery || !!bodyReview" @click="reviewResearchFacts">Review research facts</button>
              <p>Select the facts section to replace it, or leave the selection empty to add facts at the end.</p>
              <p v-if="researchIssue" role="alert">{{ researchIssue }}</p>
            </div>
            <Editor ref="editorRef" :initial-html="bodyHtml" :client="client" :show-inspector="false" @change="markDirty" @invalid="editorProblem = $event" />
          </div>
        </div>

        <!-- Details rail: Template picker (pages) first, then SEO + details. -->
        <aside
          id="writing-options"
          v-show="preferences.options && !focusMode"
          class="writing-options rail-scroll"
          @input="markDirty"
          @change="markDirty"
        >
          <div class="writing-details-heading">
            <h2>Details</h2>
            <div class="writing-details-actions">
              <button type="button" :aria-pressed="detailsExpanded" :aria-label="detailsExpanded ? 'Restore details column' : 'Expand details to full width'"
                @click="detailsExpanded = !detailsExpanded">{{ detailsExpanded ? "↙ Restore" : "↗ Expand" }}</button>
              <button type="button" aria-label="Close details" @click="preferences.options = false">✕</button>
            </div>
          </div>
          <p class="writing-details-intro">How this {{ collection.labelSingular.toLowerCase() }} appears on your site.</p>
          <EntryLocaleBar show-urls :client="client" :collection="collection" :locale="locale" :slug="entryStem" :data="data" />
          <div class="writing-address">
            <SlugField :editable="!publicUrlEditing || !currentPath || isOwner()" v-model="slug"
              :prefix="urlPrefix" :suffix="urlSuffix" :placeholder="slugPlaceholder" :label="urlLabel"
              @update:model-value="markDirty" />
            <p v-if="dirty && effectiveSlug !== savedSlug" class="writing-details-intro">Save to confirm. The old URL will get a 301 redirect after Publish.</p>
          </div>
          <WritingPanel v-if="!loading && summaryFields.length" v-model="summaryOpen" title="Summary & image">
            <FieldForm :fields="summaryFields" :data="data" :client="client" :locale="locale" dense />
          </WritingPanel>
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
            @focus-field="onFocusField"
            class="mb-4"
          />
          <WritingPanel v-if="!loading && searchFields.length" v-model="preferences.seo" title="Search appearance">
            <div>
              <p class="writing-details-intro">Customize your search listing and shared links. Leave these blank to use the post’s title, excerpt and image.</p>
              <FieldForm class="search-appearance-form" :fields="searchFields" :data="data" :client="client" :locale="locale" inline-objects />
              <details class="search-advanced">
                <summary>Advanced search settings</summary>
                <p class="writing-details-intro">Canonical URL, indexing and structured data.</p>
                <FieldForm :fields="advancedSearchFields" :data="data" :client="client" :locale="locale" inline-objects />
              </details>
            </div>
          </WritingPanel>
          <WritingPanel v-model="preferences.details" title="Publishing & organization">
            <div v-if="loading" class="space-y-4">
              <div class="skeleton h-4 w-24" />
              <div class="skeleton h-9 w-full" />
              <div class="skeleton h-4 w-24" />
              <div class="skeleton h-9 w-full" />
            </div>
            <FieldForm
              v-else
              :fields="writingDetailFields"
              :data="data"
              :client="client"
              :locale="locale"
              dense
            />
          </WritingPanel>
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
  border: none;
  min-height: calc(100vh - 10rem);
  padding: 2.75rem 3rem 3.5rem;
}
@media (max-width: 640px) {
  .editor-paper {
    padding: 1.75rem 1.5rem 2.5rem;
  }
}
</style>
