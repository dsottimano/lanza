<script setup lang="ts">
// Live preview of an arbitrary HTML `body` string in a sandboxed <iframe srcdoc>,
// under the site's real stylesheet so it looks as it will on the page. A leaner
// sibling of PreviewPane: that one renders a template+slots, this one takes the
// already-rendered HTML directly (the caller owns the render), so it can preview
// the header/footer parts. Body-only swaps keep typing smooth; a full rebuild runs
// when the frame isn't painted yet. innerHTML is safe: the markup is author-trusted
// (the same template output production emits) and the sandbox omits allow-scripts.
import { ref, watch, onMounted, shallowRef } from "vue";
import type { GitHubClient } from "../backend/github";
import { reportError } from "../errors";

const props = defineProps<{ client: GitHubClient; body: string }>();

// The site's global stylesheet supplies the tokens + component classes the parts
// lean on (.site-header, .bar, .site-nav, --ink, …). Loaded once per session.
let siteCssCache: Promise<string> | null = null;
function loadSiteCss(client: GitHubClient): Promise<string> {
  siteCssCache ??= client
    .loadText("frontend/styles/site.css")
    .then((f) => f.text)
    .catch(() => ""); // no tokens is a degraded preview, never a hard failure
  return siteCssCache;
}

const siteCss = ref("");
const loading = ref(true);
const srcdoc = ref("");
const iframe = shallowRef<HTMLIFrameElement>();

function buildDoc(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>${siteCss.value}
html,body{margin:0;background:var(--paper,#f3f1ea)}</style>
</head><body>${props.body}</body></html>`;
}

let bodyTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBodyUpdate(): void {
  clearTimeout(bodyTimer);
  bodyTimer = setTimeout(() => {
    const doc = iframe.value?.contentDocument;
    if (doc?.body) doc.body.innerHTML = props.body;
    else srcdoc.value = buildDoc(); // frame not painted yet → rebuild whole doc
  }, 180);
}

onMounted(async () => {
  try {
    siteCss.value = await loadSiteCss(props.client);
  } catch (e) {
    reportError(e, "Couldn't load site styles for the preview.");
  } finally {
    loading.value = false;
    srcdoc.value = buildDoc();
  }
});

// CSS arrives → rebuild; body edits → cheap debounced swap.
watch(siteCss, () => (srcdoc.value = buildDoc()));
watch(() => props.body, scheduleBodyUpdate);
</script>

<template>
  <div class="preview flex min-h-[24rem] flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--paper-card)]">
    <div class="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs text-zinc-500">
      <span class="size-2 rounded-full bg-emerald-400" />
      Live preview
    </div>
    <div v-if="loading" class="skeleton m-3 flex-1" />
    <iframe
      v-else
      ref="iframe"
      :srcdoc="srcdoc"
      title="Header & footer preview"
      sandbox="allow-same-origin allow-popups"
      class="min-h-0 w-full flex-1 border-0 bg-white"
    />
  </div>
</template>
