<script setup lang="ts">
// Collection rail: content collections, taxonomies, then the settings files.
// Grouping is derived from the schema (folder vs files collection).
import { COLLECTIONS, type FolderCollection, type FileEntry } from "../schema";

defineProps<{ activeCollection: string; activeSettings: string | null }>();
const emit = defineEmits<{
  (e: "select", name: string): void;
  (e: "openSettings", file: FileEntry): void;
  (e: "signout"): void;
}>();

const folders = COLLECTIONS.filter(
  (c): c is FolderCollection => c.kind === "folder",
);
const content = folders.filter((c) => c.body === "rich");
const taxonomies = folders.filter((c) => c.body === "none");
const settings = COLLECTIONS.find((c) => c.kind === "files");
const settingsFiles = settings && settings.kind === "files" ? settings.files : [];

const groupLabel = "px-2.5 mb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-400";
const item =
  "w-full rounded-lg px-2.5 py-2 text-left text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900";
const itemActive = "bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white";
</script>

<template>
  <nav class="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col gap-6 border-r border-zinc-200 bg-white px-3 py-5">
    <div class="px-2.5">
      <span class="font-serif text-xl font-bold tracking-tight text-zinc-900">Studio</span>
    </div>

    <div class="flex flex-col gap-0.5">
      <p :class="groupLabel">Content</p>
      <button
        v-for="c in content"
        :key="c.name"
        :class="[item, activeCollection === c.name && !activeSettings ? itemActive : '']"
        @click="emit('select', c.name)"
      >
        {{ c.label }}
      </button>
    </div>

    <div class="flex flex-col gap-0.5">
      <p :class="groupLabel">Taxonomies</p>
      <button
        v-for="c in taxonomies"
        :key="c.name"
        :class="[item, activeCollection === c.name && !activeSettings ? itemActive : '']"
        @click="emit('select', c.name)"
      >
        {{ c.label }}
      </button>
    </div>

    <div class="flex flex-col gap-0.5">
      <p :class="groupLabel">Settings</p>
      <button
        v-for="f in settingsFiles"
        :key="f.name"
        :class="[item, activeSettings === f.name ? itemActive : '']"
        @click="emit('openSettings', f)"
      >
        {{ f.label }}
      </button>
    </div>

    <button
      class="mt-auto rounded-lg px-2.5 py-2 text-left text-sm text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
      @click="emit('signout')"
    >
      Sign out
    </button>
  </nav>
</template>
