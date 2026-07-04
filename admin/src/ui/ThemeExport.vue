<script setup lang="ts">
// Settings → Themes → "Export your theme". Builds a theme bundle from the repo's
// current state IN THE BROWSER (GitHub tree + blobs, gzipped ustar) and downloads
// it — the same .tar.gz shape the importer applies. Design is always included;
// content and media are opt-in. Self-contained (backend/export.ts talks to the
// gh proxy directly), so no client prop is needed.
import { computed, reactive, ref } from "vue";
import { exportTheme, type ExportManifest, type ExportSelection } from "../backend/export";
import { reportError, clearError } from "../errors";

const manifest = reactive<ExportManifest>({ name: "", title: "", version: "1.0.0", description: "" });
const selection = reactive<ExportSelection>({ content: false, media: false });

const busy = ref(false);
const progress = ref({ done: 0, total: 0 });
const doneCount = ref<number | null>(null);

const slug = computed(() => manifest.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
const canExport = computed(() => slug.value.length > 0 && manifest.title.trim().length > 0);

async function run() {
  if (!canExport.value || busy.value) return;
  busy.value = true;
  doneCount.value = null;
  progress.value = { done: 0, total: 0 };
  clearError();
  try {
    doneCount.value = await exportTheme(
      { ...manifest, name: slug.value },
      { ...selection },
      (done, total) => (progress.value = { done, total }),
    );
  } catch (err) {
    reportError(err, "Couldn't export your theme.");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card mt-6 p-6">
    <h2 class="font-serif text-2xl font-bold tracking-tight text-zinc-900">Export your theme</h2>
    <p class="mt-1 text-sm text-zinc-600">
      Package your current site as a theme bundle (<code
        class="rounded bg-zinc-100 px-1 py-0.5 text-xs"
        >.tar.gz</code
      >) you can re-apply or share. It builds in your browser and downloads — nothing is committed.
    </p>

    <!-- What to include -->
    <fieldset class="mt-5">
      <legend class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Include</legend>
      <div class="mt-2 space-y-2">
        <label class="flex items-start gap-2 text-sm text-zinc-500">
          <input type="checkbox" checked disabled class="mt-0.5" />
          <span><span class="font-medium text-zinc-700">Design</span> — pages, components, layout, styles, data defaults and the content schema (always included).</span>
        </label>
        <label class="flex items-start gap-2 text-sm text-zinc-700">
          <input v-model="selection.content" type="checkbox" class="mt-0.5" :disabled="busy" />
          <span><span class="font-medium">Content</span> — every post, page and entry under <code class="rounded bg-zinc-100 px-1 text-xs">frontend/content/</code>.</span>
        </label>
        <label class="flex items-start gap-2 text-sm text-zinc-700">
          <input v-model="selection.media" type="checkbox" class="mt-0.5" :disabled="busy" />
          <span><span class="font-medium">Media</span> — uploaded images under <code class="rounded bg-zinc-100 px-1 text-xs">public/images/uploads/</code> (can be large).</span>
        </label>
      </div>
    </fieldset>

    <!-- Manifest -->
    <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="text-sm">
        <span class="mb-1 block font-medium text-zinc-700">Name <span class="text-zinc-400">(slug)</span></span>
        <input
          v-model="manifest.name"
          type="text"
          placeholder="my-theme"
          :disabled="busy"
          class="w-full rounded-lg border border-[var(--border)] bg-[var(--paper-card)] px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
        />
        <span v-if="manifest.name && slug !== manifest.name" class="mt-1 block text-xs text-zinc-400">→ {{ slug }}</span>
      </label>
      <label class="text-sm">
        <span class="mb-1 block font-medium text-zinc-700">Title</span>
        <input
          v-model="manifest.title"
          type="text"
          placeholder="My Theme"
          :disabled="busy"
          class="w-full rounded-lg border border-[var(--border)] bg-[var(--paper-card)] px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
        />
      </label>
      <label class="text-sm">
        <span class="mb-1 block font-medium text-zinc-700">Version</span>
        <input
          v-model="manifest.version"
          type="text"
          placeholder="1.0.0"
          :disabled="busy"
          class="w-full rounded-lg border border-[var(--border)] bg-[var(--paper-card)] px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
        />
      </label>
      <label class="text-sm sm:col-span-2">
        <span class="mb-1 block font-medium text-zinc-700">Description</span>
        <textarea
          v-model="manifest.description"
          rows="2"
          placeholder="One-line summary shown in the preview."
          :disabled="busy"
          class="w-full rounded-lg border border-[var(--border)] bg-[var(--paper-card)] px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
        />
      </label>
    </div>

    <!-- Success -->
    <p v-if="doneCount !== null" class="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      ✓ Exported {{ doneCount }} file{{ doneCount === 1 ? "" : "s" }} — check your downloads for
      <code class="font-mono text-xs">lanza-theme-{{ slug }}.tar.gz</code>.
    </p>

    <div class="mt-5 flex items-center gap-3">
      <button class="btn btn-primary" :disabled="!canExport || busy" @click="run">
        {{ busy ? `Exporting… ${progress.done}/${progress.total}` : "Export theme" }}
      </button>
      <span v-if="!canExport" class="text-xs text-zinc-400">Enter a name and title.</span>
    </div>
  </section>
</template>
