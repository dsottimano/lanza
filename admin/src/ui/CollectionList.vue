<script setup lang="ts">
// Generic entry list for any folder collection. Entries are listed by filename
// (the slug). Searching this listing needs no extra per-file network requests.
import { computed, onBeforeUnmount, ref, watch } from "vue";
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
const query = ref("");
const filteredEntries = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  return term ? entries.value.filter(entry => entry.name.toLocaleLowerCase().includes(term)) : entries.value;
});
const localeLabel = computed(() => site.locales.find(item => item.code === props.locale)?.label ?? props.locale);
let loadVersion = 0;
onBeforeUnmount(() => { loadVersion++; });

async function load() {
  const version = ++loadVersion;
  query.value = "";
  loading.value = true;
  failed.value = false;
  try {
    const folder = entryFolder(props.collection, props.locale);
    const files = await props.client.listDir(folder);
    if (version !== loadVersion) return;
    entries.value = files.sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch (e) {
    if (version !== loadVersion) return;
    failed.value = true;
    reportError(e, "Failed to load entries.");
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

watch(() => [props.client, entryFolder(props.collection, props.locale)], load, { immediate: true });

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
  <section class="collection-workspace" aria-labelledby="collection-title">
    <header class="collection-heading">
      <div>
        <h1 id="collection-title">{{ collection.label }}</h1>
        <p>Create, edit, and organize your {{ collection.label.toLowerCase() }}.</p>
      </div>
      <router-link class="btn btn-primary" :to="entryRoute(collection.name, locale, 'new')">
        <span class="text-lg leading-none" aria-hidden="true">+</span>
        New {{ collection.labelSingular.toLowerCase() }}
      </router-link>
    </header>

    <div class="collection-controls">
      <nav v-if="showLocales" class="collection-languages" :aria-label="`${collection.label} language`">
        <span class="collection-control-label">Language</span>
        <div class="segment">
          <router-link v-for="l in site.locales" :key="l.code"
            class="segment-btn" :class="{ 'segment-btn--active': l.code === locale }"
            :title="`${collection.label} in ${l.label}`" :aria-current="l.code === locale ? 'true' : undefined"
            :to="listRoute(collection.name, l.code)">{{ l.label }}</router-link>
        </div>
      </nav>
      <label class="collection-search">
        <span class="collection-control-label">Search filenames</span>
        <span class="collection-search-control">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input v-model="query" type="search" class="input" :placeholder="`Find a ${collection.labelSingular.toLowerCase()}…`" :disabled="loading || failed || !entries.length" />
        </span>
      </label>
    </div>

    <div class="card collection-panel" :aria-busy="loading">
      <div class="collection-list-heading">
        <span>Filename</span>
        <span v-if="!loading && !failed" role="status">{{ filteredEntries.length }}{{ query.trim() ? ` of ${entries.length}` : '' }} {{ entries.length === 1 ? 'entry' : 'entries' }}</span>
      </div>
      <ul v-if="loading" class="collection-skeleton" aria-label="Loading entries">
        <li v-for="n in 3" :key="n"><span class="skeleton h-4 w-40" /></li>
      </ul>
      <div v-else-if="failed" class="collection-empty" role="status">
        <p>Couldn't load {{ collection.label.toLowerCase() }}.</p>
        <button class="btn btn-ghost" @click="load">Try again</button>
      </div>
      <div v-else-if="!entries.length" class="collection-empty">
        <p>No {{ collection.label.toLowerCase() }} yet{{ showLocales ? ` in ${localeLabel}` : '' }}.</p>
        <router-link class="btn btn-ghost" :to="entryRoute(collection.name, locale, 'new')">Create the first one →</router-link>
      </div>
      <div v-else-if="!filteredEntries.length" class="collection-empty" role="status">
        <p>No filenames match “{{ query }}”.</p>
        <button class="btn btn-ghost" @click="query = ''">Clear search</button>
      </div>
      <ul v-else class="collection-entries">
        <li v-for="e in filteredEntries" :key="e.path">
          <router-link class="collection-entry" :to="entryRoute(collection.name, locale, slugOf(e))" :aria-label="`Edit ${slugOf(e)}`">
            <span class="collection-document" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6"/></svg></span>
            <span class="collection-filename">{{ slugOf(e) }}</span>
            <span class="collection-edit" aria-hidden="true">Edit <span>→</span></span>
          </router-link>
          <a v-if="entryUrl(collection.name, slugOf(e), locale)" :href="entryUrl(collection.name, slugOf(e), locale)!"
            target="_blank" rel="noopener noreferrer" class="collection-preview" :aria-label="`Preview ${slugOf(e)} on staging (opens in a new tab)`">Preview ↗</a>
        </li>
      </ul>
    </div>
    <p class="collection-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6 M12 7v1"/></svg>
      Saved changes stay on staging until the site owner reviews and publishes them.
    </p>
  </section>
</template>

<style scoped>
.collection-workspace { max-width: 70rem; margin: 0 auto; padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 4vw, 3rem); }
.collection-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 2rem; }
.collection-heading h1 { color: var(--ink); font-size: 2rem; font-weight: 600; letter-spacing: -.03em; line-height: 1.2; }
.collection-heading p { margin-top: .6rem; color: var(--muted); font-size: .875rem; line-height: 1.6; }
.collection-heading > .btn { flex-shrink: 0; }
.collection-controls { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 1rem 2rem; margin-bottom: 1.25rem; }
.collection-control-label { display: block; color: var(--muted); font-size: .8rem; font-weight: 500; margin-bottom: .5rem; }
.collection-languages { min-width: 0; max-width: 100%; }
.collection-languages .segment { flex-wrap: wrap; border-color: transparent; }
.collection-languages .segment-btn { white-space: nowrap; }
.collection-search { width: 17rem; max-width: 100%; margin-left: auto; }
.collection-search-control { position: relative; display: block; }
.collection-search-control > svg { position: absolute; left: .8rem; top: 50%; transform: translateY(-50%); width: 1.1rem; height: 1.1rem; color: var(--muted); pointer-events: none; }
.collection-search .input { padding-left: 2.4rem; }
.collection-search .input:disabled { opacity: .65; }
.collection-panel { overflow: hidden; box-shadow: 0 1px 2px #20273306; }
.collection-list-heading { display: flex; justify-content: space-between; gap: 1rem; padding: .85rem 1.25rem; background: var(--paper); border-bottom: 1px solid var(--border); color: var(--muted); font-size: .8rem; font-weight: 500; }
.collection-entries > li { display: flex; align-items: center; min-width: 0; }
.collection-entries > li + li { border-top: 1px solid var(--border); }
.collection-entries > li:hover { background: var(--selection); }
.collection-entry { display: flex; align-items: center; gap: .9rem; min-width: 0; flex: 1; padding: 1.1rem 1.25rem; color: var(--ink); }
.collection-entry:focus-visible { outline-offset: -3px; }
.collection-document { display: grid; place-items: center; width: 2.25rem; height: 2.5rem; flex-shrink: 0; color: var(--muted); background: var(--paper); border: 1px solid var(--border); border-radius: 6px; }
.collection-document svg { width: 1.2rem; height: 1.2rem; }
.collection-filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9rem; }
.collection-edit { margin-left: auto; color: var(--accent); font-size: .8rem; font-weight: 500; white-space: nowrap; }
.collection-edit > span { margin-left: .35rem; }
.collection-preview { flex-shrink: 0; padding: .75rem 1.25rem .75rem 0; color: var(--muted); font-size: .8rem; }
.collection-preview:hover { color: var(--accent); text-decoration: underline; }
.collection-empty { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 3rem 1.5rem; color: var(--muted); text-align: center; font-size: .9rem; overflow-wrap: anywhere; }
.collection-skeleton li { display: flex; padding: 1.5rem; }
.collection-note { display: flex; align-items: flex-start; gap: .65rem; margin-top: 1.5rem; font-size: .8rem; line-height: 1.7; color: var(--muted); }
.collection-note svg { width: 1.1rem; height: 1.1rem; flex-shrink: 0; margin-top: .12rem; }
@media (max-width: 600px) {
  .collection-search { width: 100%; }
  .collection-heading { align-items: flex-start; margin-bottom: 1.5rem; }
  .collection-heading > div { width: 100%; }
  .collection-entry { padding: 1rem; gap: .65rem; }
  .collection-document { display: none; }
  .collection-preview { padding-right: 1rem; }
  .collection-languages .segment-btn { min-height: 2.75rem; }
}
</style>
