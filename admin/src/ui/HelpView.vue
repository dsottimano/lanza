<script setup lang="ts">
// In-CMS Guide: bundled help docs (admin/src/help/*.md) rendered with marked.
// No GitHub calls — works offline. A table-of-contents rail + the rendered doc.
import { computed, ref } from "vue";
import { marked } from "marked";
import { HELP_DOCS } from "../help";

defineEmits<{ (e: "back"): void }>();

const activeSlug = ref(HELP_DOCS[0]?.slug ?? "");
const active = computed(
  () => HELP_DOCS.find((d) => d.slug === activeSlug.value) ?? HELP_DOCS[0],
);
const html = computed(
  () => marked.parse(active.value?.body ?? "", { async: false, gfm: true }) as string,
);

const tocItem =
  "w-full rounded-lg px-2.5 py-2 text-left text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900";
const tocActive = "bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white";
</script>

<template>
  <div class="min-h-screen bg-zinc-50">
    <header class="sticky top-0 z-30 flex items-center gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button class="text-sm text-zinc-500 transition hover:text-zinc-900" @click="$emit('back')">← Back</button>
      <span class="text-sm font-semibold text-zinc-900">Guide</span>
    </header>

    <div class="mx-auto flex max-w-4xl gap-8 px-6 py-8">
      <nav class="hidden w-52 flex-shrink-0 flex-col gap-0.5 sm:flex">
        <button
          v-for="d in HELP_DOCS"
          :key="d.slug"
          :class="[tocItem, activeSlug === d.slug ? tocActive : '']"
          @click="activeSlug = d.slug"
        >
          {{ d.title }}
        </button>
      </nav>

      <article class="help-prose min-w-0 flex-1" v-html="html" />
    </div>
  </div>
</template>

<style scoped>
/* Tailwind's preflight strips defaults, so style the rendered markdown here. */
.help-prose :deep(h1) {
  font-family: ui-serif, Georgia, serif;
  font-size: 1.9rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-bottom: 1rem;
  color: #18181b;
}
.help-prose :deep(h2) {
  font-family: ui-serif, Georgia, serif;
  font-size: 1.3rem;
  font-weight: 700;
  margin: 2rem 0 0.6rem;
  color: #18181b;
}
.help-prose :deep(p),
.help-prose :deep(li) {
  font-size: 0.95rem;
  line-height: 1.7;
  color: #3f3f46;
}
.help-prose :deep(p) {
  margin: 0.75rem 0;
}
.help-prose :deep(ul),
.help-prose :deep(ol) {
  margin: 0.75rem 0;
  padding-left: 1.4rem;
}
.help-prose :deep(ul) {
  list-style: disc;
}
.help-prose :deep(ol) {
  list-style: decimal;
}
.help-prose :deep(li) {
  margin: 0.3rem 0;
}
.help-prose :deep(a) {
  color: #2563eb;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.help-prose :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
  background: #f4f4f5;
  padding: 0.1rem 0.35rem;
  border-radius: 0.3rem;
}
.help-prose :deep(strong) {
  font-weight: 700;
  color: #18181b;
}
.help-prose :deep(hr) {
  margin: 1.5rem 0;
  border: none;
  border-top: 1px solid #e4e4e7;
}
</style>
