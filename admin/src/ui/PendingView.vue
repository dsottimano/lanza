<script setup lang="ts">
// "What needs me today" — everything the working branch holds that the live site
// doesn't, in one screen. One `compare` request builds the whole list (see
// backend/pending-changes.ts); opening a row is what loads that entry's detail.
//
// Two things this screen is careful NOT to imply:
//
//   * That any row can be published on its own. Publishing is a staging→main
//     merge, all of it at once, so the only control here is a link to the Publish
//     screen labelled as what it does. A per-row "Publish" button would quietly
//     ship every other row with it.
//   * That everything pending is a page. A settings file, a template and an
//     upload are all real pending changes and all belong on this list, but each
//     is labelled as itself (the classifier's tagged union makes mislabelling a
//     compile error rather than a review catch).
import { computed, onMounted, ref } from "vue";
import { GitHubClient } from "../backend/github";
import {
  loadPendingChanges,
  movedPublicUrl,
  type PendingChange,
  type ChangeTarget,
} from "../backend/pending-changes";
import { COLLECTIONS, getCollection, entryFolder, fileEntryPath, type FileEntry } from "../schema";
import { SCHEMA_PATH } from "../backend/schema";
import { site } from "../backend/site";
import { entryRoute } from "../router";
import { reportError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const changes = ref<PendingChange[]>([]);
const loading = ref(true);
const failed = ref(false);

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    changes.value = await loadPendingChanges(props.client);
  } catch (e) {
    failed.value = true;
    reportError(e, "Couldn't load what's waiting to publish.");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Ordered by BLAST RADIUS, widest first, because that is the order in which a
// reviewer should spend attention: a settings change (the content model, the menu,
// redirects) reshapes the whole site, a template changes every page using it, and
// an entry changes one page. Media last — an upload is the one thing here that
// only appears where a page already points at it.
const GROUPS: { kind: ChangeTarget["kind"]; label: string; blurb: string }[] = [
  { kind: "settings", label: "Settings", blurb: "Site-wide — affects every page." },
  { kind: "template", label: "Templates", blurb: "Affects every page using the template." },
  { kind: "entry", label: "Content", blurb: "One page each." },
  { kind: "media", label: "Media", blurb: "Uploads and static files." },
  { kind: "other", label: "Other files", blurb: "Not something the CMS edits." },
];

/** Sort key: collection, then SLUG, then locale — so a page and its translations
 *  sit next to each other instead of being split across locale folders. */
function sortKey(c: PendingChange): string {
  return c.target.kind === "entry"
    ? `${c.target.collection}/${c.target.slug}/${c.target.locale ?? ""}`
    : c.path;
}

const groups = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    rows: changes.value
      .filter((c) => c.target.kind === g.kind)
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
  })).filter((g) => g.rows.length > 0),
);

const nothingWaiting = computed(() => !loading.value && !failed.value && !changes.value.length);

// ── rows → the screen that owns them ────────────────────────────────────────

const settingsFiles = (): FileEntry[] => {
  const fc = COLLECTIONS.find((c) => c.kind === "files");
  return fc && fc.kind === "files" ? fc.files : [];
};

// Which declared settings file a repo path is, localized variants included
// (data/menu.json → data/menu.es.json). fileEntryPath owns that splicing rule, so
// this asks it rather than restating it.
function settingsFileFor(path: string): FileEntry | null {
  for (const f of settingsFiles()) {
    if (f.file === path) return f;
    if (f.localized && site.locales.some((l) => fileEntryPath(f, l.code) === path)) return f;
  }
  return null;
}

// Settings files whose own editor was folded into a merged pane — the same
// mapping ui/Sidebar.vue makes in its Design and Structure groups. Without this,
// `/settings/menu` resolves to a pane nothing renders.
const FOLDED_PANEL: Record<string, string> = {
  menu: "header-footer",
  appearance: "brand-themes",
};

function routeFor(change: PendingChange): string | null {
  const t = change.target;

  if (t.kind === "entry") {
    const c = getCollection(t.collection);
    if (!c || c.kind !== "folder") return null;
    const locale = t.locale ?? site.defaultLocale;
    // Only link when the URL round-trips to THIS file. App.vue derives the entry
    // it opens as entryFolder(collection, locale)/<slug>.md, so a path that
    // doesn't reconstruct — the home page living at a localized collection's root
    // is the real case — would open a different entry, or a blank new one.
    return `${entryFolder(c, locale)}/${t.slug}.md` === change.path
      ? entryRoute(c.name, locale, t.slug)
      : null;
  }

  if (t.kind === "settings") {
    if (t.file === SCHEMA_PATH) return "/settings/contentTypes";
    const f = settingsFileFor(t.file);
    if (!f) return null; // e.g. data/site.json — no one screen owns all of it
    return `/settings/${FOLDED_PANEL[f.name] ?? f.name}`;
  }

  // Templates are edited inside the page that uses them, and media has no screen
  // of its own — the row still shows what changed, it just isn't a link.
  return null;
}

/** What to call a row. Entries read as a title, everything else as its path. */
function rowLabel(change: PendingChange): string {
  const t = change.target;
  if (t.kind === "entry") return t.slug;
  if (t.kind === "template") return t.template;
  return change.path;
}

function rowDetail(change: PendingChange): string {
  const t = change.target;
  if (t.kind !== "entry") return change.path;
  const c = getCollection(t.collection);
  const name = c?.label ?? t.collection;
  return t.locale ? `${name} · ${t.locale}` : name;
}

const STATUS_WORD: Record<PendingChange["status"], string> = {
  added: "new",
  modified: "edited",
  removed: "deleted",
  renamed: "renamed",
};

const redirectsPanel = computed(() => {
  const f = settingsFiles().find((x) => x.name === "redirects");
  return f ? `/settings/${f.name}` : null;
});
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">
        ← Back
      </button>
      <!-- The only publish control on this screen, and it says what it does: there
           is no per-row publish, so offering one would be a lie. -->
      <router-link v-if="changes.length" class="btn btn-primary" to="/publish">
        Publish everything
      </router-link>
    </header>

    <main class="mx-auto max-w-3xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">
        Waiting to publish
      </h1>
      <p class="mb-6 text-sm text-zinc-600">
        Everything saved to your drafts that the live site doesn't have yet. Publishing sends
        <strong>all of it</strong> at once.
      </p>

      <div v-if="loading" class="card divide-y divide-[var(--border)] overflow-hidden">
        <div v-for="n in 4" :key="n" class="px-4 py-3.5">
          <span class="skeleton h-3.5 w-48 block" />
        </div>
      </div>

      <div
        v-else-if="failed"
        class="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--paper-card)] py-12 text-center"
      >
        <p class="text-sm text-zinc-600">Couldn't check what's waiting.</p>
        <button
          class="mt-3 text-sm font-medium text-zinc-900 underline-offset-2 hover:underline"
          @click="load"
        >
          Try again
        </button>
      </div>

      <!-- The healthy state. Nothing pending is good news and reads like it —
           not an empty table, and emphatically not an error. -->
      <div
        v-else-if="nothingWaiting"
        class="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--paper-card)] py-16 text-center"
      >
        <p class="text-sm font-medium text-zinc-900">Nothing waiting.</p>
        <p class="mt-1 text-sm text-zinc-600">Your site matches what's published.</p>
      </div>

      <div v-else class="flex flex-col gap-6">
        <section v-for="g in groups" :key="g.kind">
          <div class="mb-2 flex items-baseline justify-between">
            <h2 class="text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
              {{ g.label }}
            </h2>
            <span class="text-xs text-zinc-400">{{ g.blurb }}</span>
          </div>

          <ul class="card divide-y divide-[var(--border)] overflow-hidden">
            <li
              v-for="row in g.rows"
              :key="row.path"
              class="group flex items-center transition hover:bg-[var(--surface)]"
            >
              <component
                :is="routeFor(row) ? 'router-link' : 'div'"
                :to="routeFor(row) ?? undefined"
                class="min-w-0 flex-1 px-4 py-3 text-left"
              >
                <span class="flex items-baseline gap-2">
                  <span class="truncate text-sm text-zinc-800">{{ rowLabel(row) }}</span>
                  <span class="shrink-0 text-xs uppercase tracking-wide text-zinc-400">
                    {{ STATUS_WORD[row.status] }}
                  </span>
                </span>
                <span class="mt-0.5 block truncate text-xs text-zinc-500">{{ rowDetail(row) }}</span>

                <!-- The one case where publishing BREAKS something that already
                     works: the address moved, so every existing link to it 404s
                     unless a redirect goes out with it. -->
                <span v-if="movedPublicUrl(row)" class="mt-1 flex flex-wrap items-center gap-1.5">
                  <span class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                    Address changed
                  </span>
                  <span class="text-xs text-zinc-500">was {{ row.previous?.path }}</span>
                </span>
              </component>

              <router-link
                v-if="movedPublicUrl(row) && redirectsPanel"
                :to="redirectsPanel"
                class="shrink-0 px-3 py-3 text-xs text-zinc-500 opacity-0 transition focus:opacity-100 hover:text-zinc-900 hover:underline group-hover:opacity-100"
              >
                Add redirect
              </router-link>
            </li>
          </ul>
        </section>
      </div>
    </main>
  </div>
</template>
