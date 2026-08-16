<script setup lang="ts">
// Generic entry list for any folder collection. Entries are listed by filename
// (the slug); titles would need a per-file fetch, which isn't worth it here.
import { computed, ref, watch } from "vue";
import { GitHubClient, type RepoFile } from "../backend/github";
import { entryFolder, type FolderCollection } from "../schema";
import type { Locale } from "../backend/config";
import { site } from "../backend/site";
import { reportError } from "../errors";
import { entryRoute, listRoute } from "../router";
import { entryUrl } from "../backend/site-urls";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
}>();

// Rows + "new" are real links (router-links) to real entry URLs, so a page has a
// deep-linkable address and the language switch can swap to its translation.
const slugOf = (file: RepoFile) => file.name.replace(/\.md$/, "");

const entries = ref<RepoFile[]>([]);
const loading = ref(true);
const failed = ref(false);

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    const folder = entryFolder(props.collection, props.locale);
    entries.value = (await props.client.listDir(folder)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch (e) {
    failed.value = true;
    reportError(e, "Failed to load entries.");
  } finally {
    loading.value = false;
  }
}

watch(() => props.collection.name, load, { immediate: true });

// Which language of THIS collection you are looking at. It lives here, next to the
// list it scopes, for the same reason the entry editor's bar lives on the entry:
// language is a property of the thing on screen, not a mode the whole CMS is in.
// A shared collection (authors) has one set of files for every language, so it has
// nothing to switch. No per-locale counts — that would cost a request per language
// on every list load, to answer a question the list itself answers on arrival.
const showLocales = computed(
  () => site.locales.length > 1 && props.collection.localized === true,
);
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-7">
    <div class="mb-5 flex items-end justify-between">
      <div>
        <h1 class="font-serif text-3xl font-bold tracking-tight text-zinc-900">{{ collection.label }}</h1>
        <p v-if="!loading && !failed" class="mt-1 text-sm text-zinc-600">
          {{ entries.length }} {{ entries.length === 1 ? "entry" : "entries" }}
        </p>
        <!-- Which language of this collection. Same idiom as the entry's own bar. -->
        <div v-if="showLocales" class="mt-2.5 flex items-center gap-2 text-xs">
          <span class="uppercase tracking-wide text-zinc-400">Language</span>
          <div class="segment">
            <router-link
              v-for="l in site.locales"
              :key="l.code"
              class="segment-btn whitespace-nowrap px-2.5 text-center"
              :class="{ 'segment-btn--active': l.code === locale }"
              :title="`${collection.label} in ${l.label}`"
              :aria-current="l.code === locale ? 'true' : undefined"
              :to="listRoute(collection.name, l.code)"
            >
              {{ l.label }}
            </router-link>
          </div>
        </div>
      </div>
      <router-link class="btn btn-primary" :to="entryRoute(collection.name, locale, 'new')">
        <span class="text-base leading-none">+</span>
        New {{ collection.labelSingular.toLowerCase() }}
      </router-link>
    </div>

    <!-- Layout-stable skeleton: same rounded card shell as the list, so content
         appearing doesn't reflow the page. -->
    <ul v-if="loading" class="card divide-y divide-[var(--border)] overflow-hidden">
      <li v-for="n in 5" :key="n" class="flex items-center justify-between px-4 py-3.5">
        <span class="skeleton h-3.5 w-40" />
      </li>
    </ul>

    <div v-else-if="failed" class="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--paper-card)] py-12 text-center">
      <p class="text-sm text-zinc-600">Couldn't load {{ collection.label.toLowerCase() }}.</p>
      <button class="mt-3 text-sm font-medium text-zinc-900 underline-offset-2 hover:underline" @click="load">
        Try again
      </button>
    </div>

    <div
      v-else-if="!entries.length"
      class="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--paper-card)] py-16 text-center"
    >
      <p class="text-sm text-zinc-600">No {{ collection.label.toLowerCase() }} yet.</p>
      <router-link
        class="mt-3 inline-block text-sm font-medium text-zinc-900 underline-offset-2 hover:underline"
        :to="entryRoute(collection.name, locale, 'new')"
      >
        Create the first one →
      </router-link>
    </div>

    <ul v-else class="card divide-y divide-[var(--border)] overflow-hidden">
      <li
        v-for="e in entries"
        :key="e.path"
        class="group flex items-center transition hover:bg-[var(--surface)]"
      >
        <router-link
          class="min-w-0 flex-1 px-4 py-3.5 text-left"
          :to="entryRoute(collection.name, locale, slugOf(e))"
        >
          <span class="block truncate text-sm text-zinc-800">{{ slugOf(e) }}</span>
        </router-link>
        <!-- Points at STAGING, not the live site: an entry saved here isn't public
             until Publish, so a live link would 404 on what you just wrote. Absent
             for collections with no public page. -->
        <a
          v-if="entryUrl(collection.name, slugOf(e), locale)"
          :href="entryUrl(collection.name, slugOf(e), locale)!"
          target="_blank"
          rel="noopener"
          class="shrink-0 px-3 py-3.5 text-xs text-zinc-500 opacity-0 transition focus:opacity-100 hover:text-zinc-900 hover:underline group-hover:opacity-100"
        >
          View ↗
        </a>
        <span
          class="shrink-0 pr-4 text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-zinc-600"
          aria-hidden="true"
          >→</span
        >
      </li>
    </ul>
  </div>
</template>
