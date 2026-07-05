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
// scroll position untouched. Read-only for now (in-place editing is a later phase).
import { ref, watch, onMounted, shallowRef } from "vue";
import { render } from "../../../frontend/lib/template-render";
import { templateHtmlPath } from "../backend/templates";
import type { GitHubClient } from "../backend/github";
import { reportError } from "../errors";

const props = defineProps<{
  client: GitHubClient;
  preset: string;
  slots: Record<string, unknown>;
}>();

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

function renderBody(): string {
  return templateHtml.value === null ? "" : render(templateHtml.value, props.slots);
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
</head><body>${renderBody()}</body></html>`;
}

// Body-only swap: keeps <head>/styles + scroll. Falls back to a full reload if the
// frame's document isn't reachable yet (it will carry the latest body via srcdoc).
// innerHTML is safe here: it's the exact author-trusted template markup production
// emits verbatim (render() HTML-escapes user slot values), and the iframe sandbox
// omits allow-scripts, so no injected markup can execute — strictly less privileged
// than the live page.
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

// Template or CSS change → rebuild the whole document (new markup/styles).
watch([templateHtml, siteCss], () => {
  if (templateHtml.value !== null) srcdoc.value = buildDoc();
});
// Switching templates reloads the HTML (which triggers the rebuild above).
watch(() => props.preset, loadTemplate);
// Slot edits → cheap debounced body swap, no reload.
watch(() => props.slots, scheduleBodyUpdate, { deep: true });
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
      sandbox="allow-same-origin allow-popups"
      class="min-h-0 w-full flex-1 border-0 bg-white"
    />
  </div>
</template>
