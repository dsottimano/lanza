<script setup lang="ts">
// The languages THIS entry exists in, on the entry itself.
//
// It replaces the global language switch that used to sit on the sidebar. Language
// is a property of the thing you are editing, not a mode the whole CMS is in: from
// the sidebar you could not tell whether the page you were looking at even HAD a
// Spanish version, and switching took you to a blank new-entry screen with no way
// back. Here every language says which it is — one you can open, or one you can
// start.
//
// Starting one copies the structure and the slug, never the words. Translations are
// linked by filename stem (backend/translations.ts), so the slug has to carry over
// or the two files are not the same entry as far as the build is concerned; the
// prose must NOT, because English text sitting under /es reads as a translation and
// nobody ever notices it isn't one.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import type { Locale } from "../backend/config";
import { site } from "../backend/site";
import { findTranslations, setTranslationSeed, translationShell } from "../backend/translations";
import { entryRoute } from "../router";
import { reportError } from "../errors";

const props = defineProps<{
  client: GitHubClient;
  collection: FolderCollection;
  locale: Locale;
  /** The entry's stem — the filename translations are matched on. */
  slug: string;
  /** The entry's frontmatter, read only to shape a new translation's shell. */
  data: Record<string, unknown>;
}>();

const router = useRouter();

// A single-language site has nothing to switch, and a shared collection (authors)
// has one file serving every language — neither gets a bar. Neither does an entry
// with no slug yet: there is nothing to look up, and nothing to link a translation to.
const show = computed(
  () => site.locales.length > 1 && props.collection.localized === true && !!props.slug,
);

const existing = ref<Set<Locale>>(new Set());
const loaded = ref(false);

// Until the lookup lands, no language is marked missing — a "+" that appears and
// then vanishes reads as an offer the CMS retracted.
const exists = (code: Locale) => !loaded.value || existing.value.has(code);

watch(
  () => [show.value, props.collection.name, props.slug] as const,
  async () => {
    loaded.value = false;
    if (!show.value) return;
    try {
      existing.value = await findTranslations(
        props.client,
        props.collection,
        props.slug,
        site.locales.map((l) => l.code),
      );
      loaded.value = true;
    } catch (e) {
      // Advisory chrome: a failed lookup leaves every language unmarked (and so
      // openable) rather than claiming translations don't exist.
      reportError(e, "Couldn't check this entry's other languages.");
    }
  },
  { immediate: true },
);

function open(code: Locale) {
  if (code === props.locale) return;
  if (exists(code)) {
    router.push(entryRoute(props.collection.name, code, props.slug));
    return;
  }
  // Nothing is written here — the shell is parked for the new-entry editor, which
  // still refuses to save without a title. So "create" costs the user nothing until
  // they have actually written something.
  setTranslationSeed({
    collection: props.collection.name,
    locale: code,
    slug: props.slug,
    data: translationShell(props.data),
  });
  router.push({
    path: entryRoute(props.collection.name, code, "new"),
    query: { slug: props.slug },
  });
}

function hint(code: Locale, label: string): string {
  if (code === props.locale) return `Editing the ${label} version`;
  return exists(code)
    ? `Open the ${label} version`
    : `Start the ${label} version — same URL and layout, no text copied over`;
}
</script>

<template>
  <div v-if="show" class="flex items-center gap-2 text-xs">
    <span class="uppercase tracking-wide text-zinc-400">Language</span>
    <div class="segment">
      <button
        v-for="l in site.locales"
        :key="l.code"
        type="button"
        class="segment-btn whitespace-nowrap px-2.5"
        :class="{ 'segment-btn--active': l.code === locale }"
        :title="hint(l.code, l.label)"
        :aria-current="l.code === locale ? 'true' : undefined"
        @click="open(l.code)"
      >
        {{ l.label }}<span v-if="!exists(l.code)" class="ml-1 text-zinc-400" aria-hidden="true"
          >+</span
        >
      </button>
    </div>
  </div>
</template>
