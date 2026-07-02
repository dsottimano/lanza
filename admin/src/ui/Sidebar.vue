<script setup lang="ts">
// Collection rail: content collections, taxonomies, then the settings files.
// Grouping is derived from the schema (folder vs files collection).
import { COLLECTIONS, type FolderCollection, type FileEntry } from "../schema";
import type { Locale } from "../backend/config";
import { site } from "../backend/site";

defineProps<{
  activeCollection: string;
  activeSettings: string | null;
  languagesOpen: boolean;
  themesOpen: boolean;
  healthOpen: boolean;
  locale: Locale;
  helpOpen: boolean;
}>();
const emit = defineEmits<{
  (e: "select", name: string): void;
  (e: "selectLocale", locale: Locale): void;
  (e: "openSettings", file: FileEntry): void;
  (e: "languages"): void;
  (e: "themes"): void;
  (e: "health"): void;
  (e: "help"): void;
}>();

const folders = COLLECTIONS.filter(
  (c): c is FolderCollection => c.kind === "folder",
);
const content = folders.filter((c) => c.body === "rich");
const taxonomies = folders.filter((c) => c.body === "none");
const settings = COLLECTIONS.find((c) => c.kind === "files");
const settingsFiles = settings && settings.kind === "files" ? settings.files : [];

const groupLabel = "px-2.5 mb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-600";
const item = "nav-item block";
const itemActive = "nav-item--active";
</script>

<template>
  <nav class="rail-glass sticky top-3 m-3 flex h-[calc(100vh-1.5rem)] w-60 flex-shrink-0 flex-col gap-6 rounded-3xl px-3 py-5">
    <!-- Distortion layer (backdrop only) — the one place the SVG filter runs. -->
    <div class="rail-glass__distortion" aria-hidden="true" />

    <div class="px-2.5">
      <span class="font-serif text-xl font-bold tracking-tight text-zinc-900">Lanza</span>
    </div>

    <!-- Active editing language. Scopes localized collections to their per-locale
         subfolder; switching resets to the list (App.setLocale). Hidden for a
         single-language site. -->
    <div v-if="site.locales.length > 1" class="px-1.5">
      <p :class="groupLabel">Language</p>
      <div class="segment">
        <button
          v-for="l in site.locales"
          :key="l.code"
          class="segment-btn"
          :class="{ 'segment-btn--active': locale === l.code }"
          @click="emit('selectLocale', l.code)"
        >
          {{ l.label }}
        </button>
      </div>
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
        :class="[item, languagesOpen ? itemActive : '']"
        @click="emit('languages')"
      >
        Languages
      </button>
      <button
        v-for="f in settingsFiles"
        :key="f.name"
        :class="[item, activeSettings === f.name ? itemActive : '']"
        @click="emit('openSettings', f)"
      >
        {{ f.label }}
      </button>
      <button
        :class="[item, themesOpen ? itemActive : '']"
        @click="emit('themes')"
      >
        Themes
      </button>
      <button
        :class="[item, healthOpen ? itemActive : '']"
        @click="emit('health')"
      >
        Site health
      </button>
    </div>

    <div class="mt-auto flex flex-col gap-0.5 border-t border-white/40 pt-3">
      <button
        class="nav-item flex items-center gap-1.5"
        :class="{ 'nav-item--active': helpOpen }"
        @click="emit('help')"
      >
        <span aria-hidden="true">📖</span> Guide
      </button>
    </div>
  </nav>
</template>
