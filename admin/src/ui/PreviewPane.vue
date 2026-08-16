<script lang="ts">
// ── Field paths: what a marker means, and how the parent addresses one ───────
// The engine stamps every text slot with `data-lanza-field="<path>"`, where the path is
// relative to the DATA ROOT it was handed. Production builds that root as
// `{ ...page.data.slots, body }` (frontend/components/PageArticle.astro:35), so a marker
// path is NOT an entry path: `heading` is really `slots.heading`, while the reserved
// `body` key is the entry's rich body and stands alone. The parent thinks in entry paths
// (that is what a change report names), so everything crossing this boundary is
// translated through the two functions below rather than by string-mashing at each site.
//
// Exported and pure so the path rules can be tested without an iframe — happy-dom gives
// a frame document but not a layout, and these rules are where the sharp edges are.

/** The reserved root key carrying the page's rich body. */
export const BODY_FIELD = "body";
/** Where every other root key lives in the entry's data. */
export const SLOTS_PREFIX = "slots";

/**
 * Does `path` fall under `wanted`? A container matches its descendants — `slots` covers
 * `slots.cards.0.heading`, because an added or removed subtree is reported as the
 * container that holds it. The `.` is load-bearing: it makes the test segment-wise, so
 * `slots` does NOT match `slotsomething`.
 */
export function fieldPathMatches(path: string, wanted: string): boolean {
  return path === wanted || path.startsWith(`${wanted}.`);
}

/** A marker's path (render-root-relative) as the entry path the parent uses. */
export function toEntryPath(markerPath: string): string {
  return fieldPathMatches(markerPath, BODY_FIELD) ? markerPath : `${SLOTS_PREFIX}.${markerPath}`;
}

/**
 * An entry path as the marker path(s) it covers, inverting toEntryPath:
 *   `body`, `body.x`      → itself
 *   `slots`               → "" — the whole container, i.e. every marker
 *   `slots.cards.0.title` → `cards.0.title`
 *   anything else         → null: a field this preview cannot show (`title`, `draft`, …)
 */
export function toMarkerPath(entryPath: string): string | null {
  if (fieldPathMatches(entryPath, BODY_FIELD)) return entryPath;
  if (entryPath === SLOTS_PREFIX) return "";
  if (fieldPathMatches(entryPath, SLOTS_PREFIX)) return entryPath.slice(SLOTS_PREFIX.length + 1);
  return null;
}

// A path is template text (`{{ a"b }}` is a legal placeholder), so it is escaped before
// it goes inside a quoted CSS attribute selector.
const cssAttr = (s: string): string => s.replace(/[\\"]/g, (c) => `\\${c}`);

/**
 * The CSS selector matching every marker under any of these entry paths. Empty string
 * when none of them are addressable here — callers must treat that as "select nothing"
 * rather than passing it to querySelector, which would throw.
 */
export function highlightSelector(entryPaths: readonly string[]): string {
  const parts: string[] = [];
  for (const entryPath of entryPaths) {
    const marker = toMarkerPath(entryPath);
    if (marker === null) continue;
    // The whole container: every marker in the document.
    if (marker === "") return "[data-lanza-field]";
    // Exact, plus the descendant form — the selector equivalent of fieldPathMatches.
    parts.push(`[data-lanza-field="${cssAttr(marker)}"]`, `[data-lanza-field^="${cssAttr(marker)}."]`);
  }
  return parts.join(",");
}

// Highlights are a STYLE RULE in the frame's <head>, never a class or attribute on the
// marker spans: `scheduleBodyUpdate()` replaces the whole body on a 180ms debounce, so
// anything written onto a span is gone by the next keystroke. The head is untouched by
// that swap, so a rule keyed on the path survives every re-render for free — there is
// nothing to re-apply.
export function highlightCss(entryPaths: readonly string[]): string {
  const selector = highlightSelector(entryPaths);
  return selector
    ? `${selector}{background:rgba(255,214,102,.45);box-shadow:0 0 0 2px rgba(217,119,6,.5);border-radius:3px}`
    : "";
}

// Only a TRIPLE-brace {{{ body }}} emits its value verbatim; a `{{ body }}` slot is
// HTML-escaped, which would print this wrapper as literal text on the page. Templates do
// use `body` as an ordinary field name (templates/manifesto/template.html:398 has
// `{{ body }}` inside an {{#each}}), so the wrapper is conditional on the template
// actually having the raw placeholder.
const RAW_BODY = /\{\{\{\s*body\s*\}\}\}/;

/**
 * The body value, wrapped so the preview can address it — the one marker the engine
 * cannot emit itself (it refuses to wrap `{{{raw}}}`, because an unbalanced `</span>` in
 * a verbatim value would close the wrapper). Safe HERE and not there because this side
 * knows what the value is: an editor-serialized body, already balanced.
 */
export function bodyForPreview(body: string, templateHtml: string): string {
  return RAW_BODY.test(templateHtml) ? `<div data-lanza-field="${BODY_FIELD}">${body}</div>` : body;
}

/**
 * What a click on this element means: the entry path to select, or null if it missed
 * every marker. `closest` picks the INNERMOST marker, so clicking a slot nested inside a
 * marked container selects the specific field.
 *
 * Separated from the listener so it can be tested on an ordinary element — happy-dom
 * does not propagate a click from inside an <a href> to a delegated listener, which is
 * precisely the case that matters (a CTA or menu slot renders its marker inside a link).
 */
export function selectionForClick(target: EventTarget | null): string | null {
  // Duck-typed, never `instanceof Element`: the target belongs to the IFRAME's realm, so
  // it is not an instance of this window's Element and an instanceof guard would reject
  // every real click.
  const el = (target as Element | null)?.closest?.("[data-lanza-field]") ?? null;
  return el ? toEntryPath(el.getAttribute("data-lanza-field") ?? "") : null;
}
</script>

<script setup lang="ts">
// Live preview of a templated page. Renders the tenant's template HTML with the
// page's reactive `slots` using the SAME engine the Astro build uses
// (frontend/lib/template-render.ts — imported, not mirrored, so preview and prod
// can't drift). The result goes into a sandboxed <iframe srcdoc> so the template's
// own <style> is isolated and the site's design tokens apply as they do on the
// live page.
//
// Two update paths keep it smooth: a full (re)load when the template or site CSS
// changes (rebuilds the whole document), and — for the common case of typing into a
// slot field — a debounced BODY-ONLY swap that leaves the <head>/styles and the
// scroll position untouched. Still read-only: nothing is edited in the frame.
//
// It also renders WITH MARKERS, so a rendered region can be traced back to the field
// that produced it: the parent drives highlight/clearHighlights/scrollToField (exposed
// below) and hears `select` when someone clicks a marked region. The path rules and the
// click decision live in the plain <script> block above, where they can be tested
// without a frame.
import { ref, watch, onMounted, shallowRef } from "vue";
import { render } from "../../../frontend/lib/template-render";
import { templateHtmlPath } from "../backend/templates";
import type { GitHubClient } from "../backend/github";
import { reportError } from "../errors";

const props = defineProps<{
  client: GitHubClient;
  preset: string;
  slots: Record<string, unknown>;
  // The page's rich body, if the parent has it. Optional because the body is NOT part of
  // `slots` — production merges it in as a reserved root key (PageArticle.astro:35) and
  // the editor holds it separately. Without it a `{{{ body }}}` template previews with an
  // empty article, which is what this pane did before markers existed.
  body?: string;
}>();

// Clicking a marked region asks the parent to focus that field. The path is an ENTRY
// path (`slots.cards.0.heading`), not the raw marker path.
const emit = defineEmits<{ select: [path: string] }>();

// The site's global stylesheet supplies the :root design tokens the templates lean
// on (--ink, --accent, --lz-*, …). Loaded once per session and shared across previews.
let siteCssCache: Promise<string> | null = null;
function loadSiteCss(client: GitHubClient): Promise<string> {
  siteCssCache ??= client
    .loadText("frontend/styles/site.css")
    .then((f) => f.text)
    .catch(() => ""); // no tokens is a degraded preview, never a hard failure
  return siteCssCache;
}

const templateHtml = ref<string | null>(null);
const siteCss = ref("");
const loading = ref(true);
const missing = ref(false);
const srcdoc = ref("");
const iframe = shallowRef<HTMLIFrameElement>();

// Entry paths the parent asked us to highlight. Held here, not in the frame, so a full
// document rebuild can re-emit the rule (see buildDoc).
const highlighted = ref<readonly string[]>([]);
const HIGHLIGHT_STYLE_ID = "lz-preview-highlight";

// What the engine renders: the same root production builds — slots plus the reserved
// `body` key (frontend/components/PageArticle.astro:35).
function renderData(): Record<string, unknown> {
  const data: Record<string, unknown> = { ...props.slots };
  if (typeof props.body === "string" && templateHtml.value !== null) {
    data.body = bodyForPreview(props.body, templateHtml.value);
  }
  return data;
}

// `markers: true` is PREVIEW ONLY, and this is the only caller allowed to set it: it
// wraps each text slot in <span data-lanza-field="…"> so a rendered region can be traced
// back to the field that produced it. The Astro build calls render() without it and gets
// byte-identical output (frontend/lib/template-render.ts).
function renderBody(): string {
  return templateHtml.value === null ? "" : render(templateHtml.value, renderData(), { markers: true });
}

// The marker stylesheet: the affordance, plus whatever is currently highlighted.
function markerCss(): string {
  return `[data-lanza-field]{cursor:pointer}${highlightCss(highlighted.value)}`;
}

// Full document: site tokens first, then the rendered template (its own <style>
// rides along in the markup). <base target=_blank> so preview links don't navigate
// the frame. A neutral page background keeps the frame from flashing.
function buildDoc(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>${siteCss.value}
html,body{margin:0;background:var(--paper,#f3f1ea)}</style>
<style id="${HIGHLIGHT_STYLE_ID}">${markerCss()}</style>
</head><body>${renderBody()}</body></html>`;
}

// Body-only swap: keeps <head>/styles + scroll. Falls back to a full reload if the
// frame's document isn't reachable yet (it will carry the latest body via srcdoc).
// innerHTML is safe here: it's the exact author-trusted template markup production
// emits verbatim (render() HTML-escapes user slot values, markers or not), and the
// iframe sandbox omits allow-scripts, so no injected markup can execute — strictly less
// privileged than the live page.
//
// This is also what every marker consumer below has to survive: it destroys and recreates
// every marker span on a 180ms debounce. Nothing here re-applies anything, because
// nothing is stored on the spans — the highlight is a <head> rule and the click handler
// is one delegated listener on <body>, and the body ELEMENT outlives its innerHTML.
let bodyTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBodyUpdate(): void {
  clearTimeout(bodyTimer);
  bodyTimer = setTimeout(() => {
    const doc = iframe.value?.contentDocument;
    if (doc?.body) doc.body.innerHTML = renderBody();
    // Frame not painted yet (edit landed during first load) → rebuild the whole
    // srcdoc so the change isn't dropped until the next template reload.
    else if (templateHtml.value !== null) srcdoc.value = buildDoc();
  }, 180);
}

async function loadTemplate(): Promise<void> {
  loading.value = true;
  try {
    const f = await props.client.loadText(templateHtmlPath(props.preset));
    templateHtml.value = f.text;
    missing.value = false;
  } catch {
    templateHtml.value = null;
    missing.value = true; // missing/removed template — show the placeholder
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    siteCss.value = await loadSiteCss(props.client);
  } catch (e) {
    reportError(e, "Couldn't load site styles for the preview.");
  }
  await loadTemplate();
});

// ── Marker consumers ────────────────────────────────────────────────────────

// Push the current highlight rule into the live document. Only needed when the parent
// changes the set between document rebuilds — a rebuild carries it in buildDoc().
function applyHighlights(): void {
  const style = iframe.value?.contentDocument?.getElementById(HIGHLIGHT_STYLE_ID);
  if (style) style.textContent = markerCss();
}

// ONE listener for the whole preview, not one per span: there are as many spans as slots
// and every one of them is replaced on each keystroke, so per-span listeners would have
// to be re-bound on a timer and would leak in between.
function onPreviewClick(e: MouseEvent): void {
  const path = selectionForClick(e.target);
  if (path === null) return;
  // A marker can sit inside an <a>, and <base target=_blank> would open a tab on the way
  // to selecting the field.
  e.preventDefault();
  emit("select", path);
}

// A body-only swap keeps the same <body> element, so the listener attached here outlives
// every re-render; a full srcdoc reload builds a NEW document, which is what this event
// is for. Removing first keeps it idempotent if a frame ever loads twice.
function onFrameLoad(): void {
  const doc = iframe.value?.contentDocument;
  if (!doc?.body) return;
  doc.body.removeEventListener("click", onPreviewClick);
  doc.body.addEventListener("click", onPreviewClick);
  applyHighlights();
}

defineExpose({
  /** Highlight every marker under these entry paths, replacing any previous set. */
  highlight(paths: readonly string[]): void {
    highlighted.value = [...paths];
    applyHighlights();
  },
  clearHighlights(): void {
    highlighted.value = [];
    applyHighlights();
  },
  /**
   * Scroll the first region under this entry path into view. Returns whether one was
   * found — a field can be absent because the template doesn't place it, or because the
   * frame hasn't painted the latest body yet.
   */
  scrollToField(path: string): boolean {
    const selector = highlightSelector([path]);
    const el = selector ? iframe.value?.contentDocument?.querySelector(selector) : null;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    return el != null;
  },
});

// Template or CSS change → rebuild the whole document (new markup/styles).
watch([templateHtml, siteCss], () => {
  if (templateHtml.value !== null) srcdoc.value = buildDoc();
});
// Switching templates reloads the HTML (which triggers the rebuild above).
watch(() => props.preset, loadTemplate);
// Slot (or body) edits → cheap debounced body swap, no reload.
watch(() => props.slots, scheduleBodyUpdate, { deep: true });
watch(() => props.body, scheduleBodyUpdate);
</script>

<template>
  <div class="preview flex min-h-[24rem] flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--paper-card)]">
    <div class="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs text-zinc-500">
      <span class="size-2 rounded-full bg-emerald-400" />
      Live preview
    </div>
    <div v-if="loading" class="skeleton m-3 flex-1" />
    <p v-else-if="missing" class="m-3 flex-1 text-sm text-zinc-500">
      Couldn’t load this template’s HTML — check
      <code>templates/{{ preset }}/template.html</code>.
    </p>
    <iframe
      v-else
      ref="iframe"
      :srcdoc="srcdoc"
      title="Page preview"
      @load="onFrameLoad"
      sandbox="allow-same-origin allow-popups"
      class="min-h-0 w-full flex-1 border-0 bg-white"
    />
  </div>
</template>
