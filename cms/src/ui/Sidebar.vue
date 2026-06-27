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
</script>

<template>
  <nav class="rail">
    <div class="brand">Studio</div>

    <div class="group">
      <p class="grouplabel">Content</p>
      <button
        v-for="c in content"
        :key="c.name"
        class="navitem"
        :class="{ active: activeCollection === c.name && !activeSettings }"
        @click="emit('select', c.name)"
      >
        {{ c.label }}
      </button>
    </div>

    <div class="group">
      <p class="grouplabel">Taxonomies</p>
      <button
        v-for="c in taxonomies"
        :key="c.name"
        class="navitem"
        :class="{ active: activeCollection === c.name && !activeSettings }"
        @click="emit('select', c.name)"
      >
        {{ c.label }}
      </button>
    </div>

    <div class="group">
      <p class="grouplabel">Settings</p>
      <button
        v-for="f in settingsFiles"
        :key="f.name"
        class="navitem"
        :class="{ active: activeSettings === f.name }"
        @click="emit('openSettings', f)"
      >
        {{ f.label }}
      </button>
    </div>

    <button class="signout" @click="emit('signout')">Sign out</button>
  </nav>
</template>

<style scoped>
.rail {
  width: 15rem;
  flex-shrink: 0;
  height: 100vh;
  position: sticky;
  top: 0;
  border-right: 1px solid var(--border, #ececec);
  padding: 1.1rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  box-sizing: border-box;
  background: #fcfcfc;
}
.brand {
  font-weight: 700;
  letter-spacing: -0.01em;
  font-size: 1.1rem;
  padding: 0 0.5rem;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.grouplabel {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #aaa;
  margin: 0 0 0.3rem 0.5rem;
}
.navitem {
  text-align: left;
  border: none;
  background: none;
  padding: 0.45rem 0.5rem;
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
  color: #333;
}
.navitem:hover {
  background: #f0f0f0;
}
.navitem.active {
  background: #1a1a1a;
  color: #fff;
}
.signout {
  margin-top: auto;
  text-align: left;
  border: none;
  background: none;
  color: #999;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.45rem 0.5rem;
}
</style>
