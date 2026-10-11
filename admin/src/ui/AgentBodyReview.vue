<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { readableBodyHtml, type BodyTarget } from "../editor/body-proposal";
const props = defineProps<{ before: string; after: string; target: BodyTarget }>();
defineEmits<{ (e: "decision", accepted: boolean): void }>();
const dialog = ref<HTMLDialogElement>();
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
const reviewDocument = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>body{font:17px/1.65 system-ui,sans-serif;color:#201d1b;background:#fff;padding:1rem;overflow-wrap:anywhere}h1,h2,h3{line-height:1.25}pre{white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4rem}blockquote{border-left:3px solid #bbb;padding-left:1rem}a{color:inherit}[data-lanza-origin="agent"]{background:#eef0ff;text-decoration:underline dotted #7770a5;text-underline-offset:4px}</style></head><body>${readableBodyHtml(html)}</body></html>`;
</script>

<template>
  <dialog ref="dialog" aria-labelledby="agent-body-title" aria-describedby="agent-body-description"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-6xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--paper)] p-6 backdrop:bg-black/30"
    @cancel.prevent="$emit('decision', false)">
    <h2 id="agent-body-title" class="text-lg font-semibold">Review agent {{ target === "selection" ? "selection replacement" : "body change" }}</h2>
    <p id="agent-body-description" class="mt-2 text-sm text-zinc-600">Compare the whole article before accepting. Dotted highlighting marks agent-written text; acceptance preserves its origin. Formatting is simplified; images and embeds appear as labels. Accept applies only in your editor and pauses autosave. Save keeps the draft; publication is separate.</p>
    <div class="mt-5 grid gap-4 md:grid-cols-2">
      <section><h3 class="mb-2 text-sm font-semibold">Current article</h3><iframe title="Current article before agent change" :srcdoc="reviewDocument(before)" sandbox="" class="h-[45vh] w-full rounded-lg border border-[var(--border)] bg-white" /></section>
      <section><h3 class="mb-2 text-sm font-semibold">Proposed article</h3><iframe title="Proposed article after agent change" :srcdoc="reviewDocument(after)" sandbox="" class="h-[45vh] w-full rounded-lg border border-[var(--border)] bg-white" /></section>
    </div>
    <details class="mt-4 text-sm"><summary class="cursor-pointer">Inspect exact editor HTML</summary>
      <div class="mt-3 grid gap-4 md:grid-cols-2"><pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-xs">{{ before }}</pre><pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-xs">{{ after }}</pre></div>
    </details>
    <div class="mt-5 flex justify-end gap-2"><button autofocus class="btn btn-ghost" @click="$emit('decision', false)">Cancel</button><button class="btn btn-primary" @click="$emit('decision', true)">Accept in editor</button></div>
  </dialog>
</template>
