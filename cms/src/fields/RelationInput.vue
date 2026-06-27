<script setup lang="ts">
// The `relation` widget. Options are the target collection's entry slugs
// (filename minus `.md`) — the slug IS the stored value (config.yml used
// value_field: {{slug}}). One cheap directory listing; no per-file fetches.
import { computed, inject, onMounted, ref } from "vue";
import type { Field } from "../schema";
import { getCollection } from "../schema";
import { CLIENT_KEY } from "./context";

const props = defineProps<{ field: Field }>();
const model = defineModel<string | string[] | undefined>();

const client = inject(CLIENT_KEY);
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
    const files = await client.listDir(target.folder);
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
  <p v-if="loading" class="muted">Loading…</p>
  <p v-else-if="error" class="err">{{ error }}</p>
  <p v-else-if="!slugs.length" class="muted">No entries yet.</p>

  <!-- multiple: checkbox chips -->
  <div v-else-if="field.multiple" class="chips">
    <label v-for="s in slugs" :key="s" class="chip" :class="{ on: selected.includes(s) }">
      <input type="checkbox" :checked="selected.includes(s)" @change="toggle(s)" />
      {{ s }}
    </label>
  </div>

  <!-- single: dropdown -->
  <select v-else v-model="model">
    <option :value="undefined">—</option>
    <option v-for="s in slugs" :key="s" :value="s">{{ s }}</option>
  </select>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 999px;
  font-size: 0.85rem;
  cursor: pointer;
  color: #555;
}
.chip.on {
  background: #1a1a1a;
  border-color: #1a1a1a;
  color: #fff;
}
.chip input {
  display: none;
}
select {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font: inherit;
  background: #fff;
}
.muted {
  color: #999;
  font-size: 0.85rem;
}
.err {
  color: #c0392b;
  font-size: 0.85rem;
}
</style>
