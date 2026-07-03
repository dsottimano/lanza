<script setup lang="ts">
// Applied-theme history + revert. Each theme apply is exactly one commit, so a
// revert is one inverse commit computed from git history (backend/themeHistory).
// This component lists recent applies and drives the plan → confirm → revert
// flow entirely on its own; ThemesView mounts it with a single line.
import { onMounted, ref, shallowRef } from "vue";
import { GitHubClient } from "../backend/github";
import {
  listAppliedThemes,
  planRevert,
  executeRevert,
  type AppliedTheme,
  type RevertPlan,
} from "../backend/themeHistory";
import { reportError, clearError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();

const loading = ref(true);
const themes = ref<AppliedTheme[]>([]);

// Confirmation flow state.
const target = shallowRef<AppliedTheme | null>(null); // theme awaiting confirmation
const plan = shallowRef<RevertPlan | null>(null);
const planning = ref(false); // building the plan (fetching history)
const reverting = ref(false); // committing the revert
const revertedSha = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    themes.value = await listAppliedThemes(props.client);
  } catch (err) {
    reportError(err, "Couldn't load theme history.");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Relative date, e.g. "3 days ago" — enough for a history list.
function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

async function startRevert(theme: AppliedTheme) {
  clearError();
  target.value = theme;
  plan.value = null;
  planning.value = true;
  try {
    plan.value = await planRevert(props.client, theme.sha);
  } catch (err) {
    target.value = null;
    reportError(err, "Couldn't work out how to revert this theme.");
  } finally {
    planning.value = false;
  }
}

function cancel() {
  target.value = null;
  plan.value = null;
}

async function confirmRevert() {
  if (!plan.value) return;
  reverting.value = true;
  clearError();
  try {
    revertedSha.value = await executeRevert(props.client, plan.value);
    target.value = null;
    plan.value = null;
    await load(); // the revert is itself a commit; refresh the list
  } catch (err) {
    reportError(err, "Reverting the theme failed — no changes were committed.");
  } finally {
    reverting.value = false;
  }
}
</script>

<template>
  <section class="mt-10">
    <h2 class="mb-1 font-serif text-2xl font-bold tracking-tight text-zinc-900">
      Applied themes
    </h2>
    <p class="mb-4 text-sm text-zinc-600">
      Each theme you applied is one commit. Reverting undoes it in a single
      commit computed from your git history.
    </p>

    <!-- Reverted confirmation -->
    <div
      v-if="revertedSha"
      class="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
    >
      <p class="font-semibold">✓ Theme reverted.</p>
      <p class="mt-1">
        Committed as <code class="font-mono text-xs">{{ revertedSha.slice(0, 7) }}</code>.
        Cloudflare Pages is rebuilding; your site updates in ~1–2 minutes.
      </p>
    </div>

    <p v-if="loading" class="text-sm text-zinc-500">Loading history…</p>

    <p
      v-else-if="themes.length === 0"
      class="rounded-2xl border border-dashed border-white/60 bg-white/40 px-5 py-8 text-center text-sm text-zinc-500"
    >
      No themes have been applied yet.
    </p>

    <ul v-else class="space-y-2">
      <li
        v-for="t in themes"
        :key="t.sha"
        class="card flex items-center justify-between gap-3 px-4 py-3"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-zinc-900">
            {{ t.title }}
            <span v-if="t.version" class="text-xs font-normal text-zinc-500">v{{ t.version }}</span>
          </p>
          <p class="text-xs text-zinc-500">{{ relative(t.date) }}</p>
        </div>
        <button
          class="shrink-0 rounded-lg border border-white/60 bg-white/50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-white/80 disabled:opacity-50"
          :disabled="planning || reverting"
          @click="startRevert(t)"
        >
          {{ planning && target?.sha === t.sha ? "Checking…" : "Revert" }}
        </button>
      </li>
    </ul>

    <!-- Confirmation dialog -->
    <div
      v-if="target && plan"
      class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 p-4 backdrop-blur-sm"
      @click.self="!reverting && cancel()"
    >
      <div class="card w-full max-w-lg p-6">
        <h3 class="font-serif text-xl font-bold tracking-tight text-zinc-900">
          Revert “{{ plan.title }}”?
        </h3>

        <ul class="mt-4 space-y-1.5 text-sm text-zinc-700">
          <li v-if="plan.restore.length">
            <strong>{{ plan.restore.length }}</strong>
            file{{ plan.restore.length === 1 ? "" : "s" }} restored to their
            previous contents.
          </li>
          <li v-if="plan.remove.length">
            <strong>{{ plan.remove.length }}</strong>
            file{{ plan.remove.length === 1 ? "" : "s" }} the theme added will be
            deleted.
          </li>
        </ul>

        <p class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Any content types the theme introduced disappear from the CMS. Posts,
          pages and media you authored stay in git — only the theme's own files
          change.
        </p>

        <div
          v-if="plan.conflicts.length"
          class="mt-3 rounded-lg bg-rose-50 px-4 py-3 text-xs text-rose-900"
        >
          <p class="font-semibold">
            {{ plan.conflicts.length }}
            file{{ plan.conflicts.length === 1 ? " was" : "s were" }} edited since
            this theme was applied — reverting will overwrite those edits:
          </p>
          <ul class="mt-1 space-y-0.5 font-mono">
            <li v-for="p in plan.conflicts" :key="p" class="truncate">{{ p }}</li>
          </ul>
        </div>

        <div class="mt-6 flex items-center gap-3">
          <button class="btn btn-primary" :disabled="reverting" @click="confirmRevert">
            {{ reverting ? "Reverting…" : "Revert theme" }}
          </button>
          <button
            v-if="!reverting"
            class="text-sm text-zinc-600 transition hover:text-zinc-900"
            @click="cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
