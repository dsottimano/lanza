<script setup lang="ts">
// Settings → Themes. Upload a prebuilt Lanza theme (.tar.gz), preview what it
// will change, then apply it — which commits every file in the bundle in ONE
// commit (Git Data API) and triggers a single Cloudflare Pages rebuild. The
// theme replaces files in place; nothing else in the repo is touched.
import { ref, shallowRef } from "vue";
import { GitHubClient } from "../backend/github";
import { parseTheme, applyTheme, type ParsedTheme } from "../backend/theme";
import { reportError, clearError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const fileName = ref("");
const theme = shallowRef<ParsedTheme | null>(null);
const showFiles = ref(false);
const applying = ref(false);
const progress = ref({ done: 0, total: 0 });
const appliedSha = ref<string | null>(null);

function reset() {
  theme.value = null;
  fileName.value = "";
  showFiles.value = false;
  appliedSha.value = null;
  progress.value = { done: 0, total: 0 };
}

async function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  reset();
  fileName.value = file.name;
  clearError();
  try {
    theme.value = await parseTheme(file);
  } catch (err) {
    fileName.value = "";
    reportError(err, "Couldn't read that theme bundle.");
  }
  (e.target as HTMLInputElement).value = ""; // allow re-picking the same file
}

async function apply() {
  if (!theme.value) return;
  applying.value = true;
  clearError();
  try {
    appliedSha.value = await applyTheme(props.client, theme.value, (done, total) => {
      progress.value = { done, total };
    });
  } catch (err) {
    reportError(err, "Applying the theme failed — no changes were committed.");
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-zinc-50">
    <header class="sticky top-0 z-30 flex items-center gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button class="text-sm text-zinc-500 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="text-sm font-semibold text-zinc-900">Themes</span>
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Themes</h1>
      <p class="mb-6 text-sm text-zinc-500">
        Upload a prebuilt theme bundle (<code class="rounded bg-zinc-100 px-1 py-0.5 text-xs">.tar.gz</code>).
        Applying it commits the theme to your repo in one commit and rebuilds the
        site — it usually goes live in a minute or two.
      </p>

      <!-- Success -->
      <div
        v-if="appliedSha"
        class="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-900"
      >
        <p class="font-semibold">✓ Theme applied.</p>
        <p class="mt-1">
          Committed as <code class="font-mono text-xs">{{ appliedSha.slice(0, 7) }}</code>.
          Cloudflare Pages is rebuilding now; your site updates in ~1–2 minutes.
        </p>
        <button
          class="mt-4 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-700"
          @click="reset"
        >
          Apply another theme
        </button>
      </div>

      <!-- Upload -->
      <label
        v-else-if="!theme"
        class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 bg-white px-6 py-12 text-center transition hover:border-zinc-400"
      >
        <span class="text-3xl" aria-hidden="true">🎨</span>
        <span class="text-sm font-medium text-zinc-700">Choose a theme bundle</span>
        <span class="text-xs text-zinc-400">.tar.gz</span>
        <input type="file" accept=".tar.gz,.tgz,application/gzip" class="hidden" @change="onPick" />
      </label>

      <!-- Preview + apply -->
      <div v-else class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="font-serif text-2xl font-bold tracking-tight text-zinc-900">
            {{ theme.manifest.title }}
          </h2>
          <span v-if="theme.manifest.version" class="text-xs text-zinc-400">v{{ theme.manifest.version }}</span>
        </div>
        <p v-if="theme.manifest.author" class="mt-0.5 text-xs text-zinc-400">by {{ theme.manifest.author }}</p>
        <p v-if="theme.manifest.description" class="mt-3 text-sm text-zinc-600">
          {{ theme.manifest.description }}
        </p>

        <div class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p>
            <strong>This rewrites {{ theme.files.length }}
            file{{ theme.files.length === 1 ? "" : "s" }}</strong>
            in your site and triggers a rebuild. Existing files at these paths are
            overwritten — you can revert from git if needed.
          </p>
          <p v-if="theme.manifest.rebuildNote" class="mt-1">{{ theme.manifest.rebuildNote }}</p>
        </div>

        <button
          class="mt-3 text-xs font-medium text-zinc-500 underline-offset-2 hover:underline"
          @click="showFiles = !showFiles"
        >
          {{ showFiles ? "Hide" : "Show" }} affected files ({{ theme.files.length }})
        </button>
        <ul v-if="showFiles" class="mt-2 max-h-48 overflow-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs text-zinc-600">
          <li v-for="f in theme.files" :key="f.path" class="truncate py-0.5">{{ f.path }}</li>
        </ul>

        <div class="mt-6 flex items-center gap-3">
          <button
            class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50"
            :disabled="applying"
            @click="apply"
          >
            {{ applying ? `Applying… ${progress.done}/${progress.total}` : "Apply theme" }}
          </button>
          <button
            v-if="!applying"
            class="text-sm text-zinc-500 transition hover:text-zinc-900"
            @click="reset"
          >
            Cancel
          </button>
        </div>
      </div>
    </main>
  </div>
</template>
