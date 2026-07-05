<script setup lang="ts">
// The editable URL/slug line under an entry title. Shows the public path with the
// slug segment as an inline, auto-widening input (framed by prefix/suffix so it
// reads as a URL). `editable: false` renders it static — used for the site root
// ("home"), which can't be renamed without breaking `/`.
//
// Changing the slug renames the entry's file on save (see useEntryEditor). Empty →
// the title-derived slug (shown as the placeholder).
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    prefix: string;
    suffix: string;
    placeholder?: string;
    editable?: boolean;
    label?: string; // "URL" for pages, "Slug" for types with no simple public path
  }>(),
  { editable: true, placeholder: "", label: "URL" },
);

const slug = defineModel<string>({ default: "" });

// Auto-width the inline input to its content (or the placeholder), within reason.
const size = computed(() =>
  Math.min(Math.max((slug.value || props.placeholder).length, 3), 48),
);
</script>

<template>
  <div class="flex items-center gap-2 text-xs">
    <span class="uppercase tracking-wide text-zinc-400">{{ label }}</span>
    <div
      class="flex items-center rounded-lg border border-[var(--border)] bg-[var(--paper-card)] px-2 font-mono text-zinc-500 transition focus-within:border-zinc-400"
    >
      <span>{{ prefix }}</span>
      <input
        v-if="editable"
        v-model="slug"
        :placeholder="placeholder"
        :size="size"
        spellcheck="false"
        autocapitalize="off"
        class="min-w-0 bg-transparent py-1.5 text-zinc-900 outline-none placeholder:text-zinc-400"
      />
      <span v-else class="py-1.5 text-zinc-700">{{ slug }}</span>
      <span>{{ suffix }}</span>
    </div>
  </div>
</template>
