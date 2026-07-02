<script setup lang="ts">
// The `relation` widget. Options are the target collection's entry slugs
// (filename minus `.md`) — the slug IS the stored value (config.yml used
// value_field: {{slug}}). One cheap directory listing; no per-file fetches.
import { computed, inject, onMounted, ref } from "vue";
import type { Field } from "../schema";
import { entryFolder, getCollection } from "../schema";
import { CLIENT_KEY, LOCALE_KEY } from "./context";
import { inputCls } from "./styles";

const props = defineProps<{ field: Field }>();
const model = defineModel<string | string[] | undefined>();

const client = inject(CLIENT_KEY);
const locale = inject(LOCALE_KEY);
const slugs = ref<string[]>([]);
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  const target = props.field.collection ? getCollection(props.field.collection) : undefined;
  if (!client || !target || target.kind !== "folder") {
    error.value = "Unknown relation target.";
    loading.value = false;
    return;
  }
  try {
    // Localized targets (categories/tags) live under folder/<locale> — scope the
    // listing to the active locale so entries actually show up.
    const dir = locale ? entryFolder(target, locale) : target.folder;
    const files = await client.listDir(dir);
    slugs.value = files.map((f) => f.name.replace(/\.md$/, "")).sort();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load options.";
  } finally {
    loading.value = false;
  }
});

const selected = computed<string[]>(() =>
  Array.isArray(model.value) ? model.value : model.value ? [model.value] : [],
);

function toggle(slug: string) {
  const cur = new Set(selected.value);
  if (cur.has(slug)) cur.delete(slug);
  else cur.add(slug);
  model.value = [...cur];
}
</script>

<template>
  <p v-if="loading" class="text-sm text-zinc-500">Loading…</p>
  <p v-else-if="error" class="text-sm text-rose-600">{{ error }}</p>
  <p v-else-if="!slugs.length" class="text-sm text-zinc-500">No entries yet.</p>

  <!-- multiple: checkbox chips -->
  <div v-else-if="field.multiple" class="flex flex-wrap gap-1.5">
    <label
      v-for="s in slugs"
      :key="s"
      class="inline-flex cursor-pointer items-center rounded-full border px-3 py-1 text-sm transition"
      :class="selected.includes(s)
        ? 'border-zinc-900 bg-zinc-900 text-white'
        : 'border-white/60 bg-white/40 text-zinc-700 hover:border-white/90'"
    >
      <input type="checkbox" class="hidden" :checked="selected.includes(s)" @change="toggle(s)" />
      {{ s }}
    </label>
  </div>

  <!-- single: dropdown -->
  <select
    v-else
    v-model="model"
    :class="inputCls"
  >
    <option :value="undefined">—</option>
    <option v-for="s in slugs" :key="s" :value="s">{{ s }}</option>
  </select>
</template>
