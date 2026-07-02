<script setup lang="ts">
// Settings → Redirects. Purpose-built editor for frontend/data/redirects.json
// ({ redirects: [{ from, to, status }] }). At deploy, scripts/gen-redirects.mjs
// validates this file and compiles the valid rules into Cloudflare's native
// public/_redirects. This screen mirrors that validation live (see
// ../backend/redirect-rules.ts) so what you see flagged here is what the build
// will keep or skip. The file is NOT localized — one list for the whole site.
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient, GitHubError } from "../backend/github";
import { CloudflareClient, NotConfiguredError } from "../backend/cloudflare";
import {
  ruleError,
  ruleWarnings,
  normalizeRule,
  STATUS_OPTIONS,
  STATUS_LABELS,
  type RedirectRule,
} from "../backend/redirect-rules";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const REDIRECTS_PATH = "frontend/data/redirects.json";
// Cloudflare Pages' static _redirects file caps at 2,000 rules.
const RULE_CEILING = 2000;

const loading = ref(true);
const rows = reactive<RedirectRule[]>([]);
let sha: string | undefined;

const markDirty = () => (isDirty.value = true);
onUnmounted(() => (isDirty.value = false));

async function load() {
  loading.value = true;
  rows.splice(0, rows.length);
  try {
    let raw: unknown[] = [];
    try {
      const loaded = await props.client.loadJson(REDIRECTS_PATH);
      sha = loaded.sha;
      if (Array.isArray(loaded.data.redirects)) raw = loaded.data.redirects as unknown[];
    } catch (e) {
      // No redirects file yet — start empty and create it on first save.
      if (e instanceof GitHubError && e.status === 404) sha = undefined;
      else throw e;
    }
    rows.push(...raw.map(normalizeRule));
  } catch (e) {
    reportError(e, "Failed to load redirects.");
  } finally {
    loading.value = false;
    isDirty.value = false;
  }
}

// ── validation (mirrors gen-redirects.mjs via redirect-rules.ts) ────────────
const isBlank = (r: RedirectRule) => !r.from.trim() && !r.to.trim();

// Per-row diagnostics, indexed alongside `rows`. Blank rows (a fresh line the
// user hasn't filled) are neither valid nor invalid — they're just skipped.
const diagnostics = computed(() =>
  rows.map((r, i) => {
    if (isBlank(r)) return { error: null as string | null, warnings: [] as string[] };
    return { error: ruleError(r), warnings: ruleWarnings(r, rows, i) };
  }),
);

const activeCount = computed(
  () => rows.filter((r, i) => !isBlank(r) && diagnostics.value[i].error === null).length,
);
const invalidCount = computed(
  () => rows.filter((r, i) => !isBlank(r) && diagnostics.value[i].error !== null).length,
);
const nearCeiling = computed(() => activeCount.value >= RULE_CEILING * 0.9);

// ── row operations ──────────────────────────────────────────────────────────
function addRow() {
  rows.push({ from: "", to: "", status: 301 });
  markDirty();
}
function removeRow(i: number) {
  rows.splice(i, 1);
  markDirty();
}
function move(i: number, delta: number) {
  const to = i + delta;
  if (to < 0 || to >= rows.length) return;
  const [row] = rows.splice(i, 1);
  rows.splice(to, 0, row);
  markDirty();
}

// ── save ────────────────────────────────────────────────────────────────────
async function save() {
  if (invalidCount.value > 0) {
    const n = invalidCount.value;
    const ok = confirm(
      `${n} invalid rule${n === 1 ? "" : "s"} will be ignored by the build — save anyway?`,
    );
    if (!ok) return;
  }
  // Persist trimmed, non-blank rows in order. Trimming matches what the editor
  // validated and what gen-redirects will accept.
  const redirects = rows
    .filter((r) => !isBlank(r))
    .map((r) => ({ from: r.from.trim(), to: r.to.trim(), status: r.status }));
  sha = await props.client.saveJson(REDIRECTS_PATH, { redirects }, `lanza: update ${REDIRECTS_PATH}`, sha);
  isDirty.value = false;
  void loadDeploy(); // reflect that a new build is (soon) publishing
}

// ── deploy status (Cloudflare Pages) ────────────────────────────────────────
const cf = new CloudflareClient();
type DeployState =
  | { kind: "loading" }
  | { kind: "not-configured" }
  | { kind: "error"; message: string }
  | { kind: "none" }
  | { kind: "live"; at: string }
  | { kind: "publishing"; at: string }
  | { kind: "failed"; at: string; detail: string };
const deploy = ref<DeployState>({ kind: "loading" });

async function loadDeploy() {
  deploy.value = { kind: "loading" };
  try {
    const [d] = await cf.listDeployments(1);
    if (!d) {
      deploy.value = { kind: "none" };
      return;
    }
    const stage = d.latest_stage;
    const at = d.created_on;
    if (!stage) {
      deploy.value = { kind: "publishing", at };
    } else if (stage.status === "failure" || stage.status === "canceled") {
      deploy.value = { kind: "failed", at, detail: `${stage.name} ${stage.status}` };
    } else if (stage.status === "success" && stage.name === "deploy") {
      deploy.value = { kind: "live", at };
    } else {
      deploy.value = { kind: "publishing", at };
    }
  } catch (e) {
    if (e instanceof NotConfiguredError) {
      deploy.value = { kind: "not-configured" };
      return;
    }
    deploy.value = { kind: "error", message: e instanceof Error ? e.message : "Couldn’t load publish status." };
  }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

// The single status line, unsaved-changes taking precedence over deploy state.
const deployTone = computed(() => {
  if (isDirty.value) return "amber";
  switch (deploy.value.kind) {
    case "live":
      return "emerald";
    case "publishing":
    case "loading":
      return "blue";
    case "failed":
    case "error":
      return "rose";
    default:
      return "muted";
  }
});
const deployText = computed(() => {
  if (isDirty.value) return "You have unsaved changes — Save to publish.";
  const s = deploy.value;
  switch (s.kind) {
    case "loading":
      return "Checking publish status…";
    case "not-configured":
      return "Connect Cloudflare in Site Health to see publish status here.";
    case "error":
      return s.message;
    case "none":
      return "No published deploy yet.";
    case "live":
      return `Live — last published ${timeAgo(s.at)}.`;
    case "publishing":
      return "Publishing now…";
    case "failed":
      return `Last publish failed (${s.detail}).`;
  }
  return "";
});

onMounted(() => {
  void load();
  void loadDeploy();
});

// ── shared class strings (match MenuView) ───────────────────────────────────
const cellInput =
  "w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400";
const iconBtn =
  "grid size-7 flex-shrink-0 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";
const toneRing: Record<string, string> = {
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  muted: "bg-zinc-300",
};
</script>

<template>
  <div class="min-h-screen bg-zinc-50">
    <header class="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/85 px-5 py-2.5 backdrop-blur">
      <button class="text-sm text-zinc-500 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm"></span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-3xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Redirects</h1>
      <p class="mb-6 text-sm text-zinc-500">
        Send visitors from an old path to a new one. Rules apply top to bottom — the first match wins.
      </p>

      <!-- Status panel -->
      <section class="mb-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-2.5">
          <span
            class="size-2.5 flex-shrink-0 rounded-full"
            :class="[toneRing[deployTone], deploy.kind === 'publishing' && !isDirty ? 'animate-pulse' : '']"
            aria-hidden="true"
          />
          <p class="text-sm font-medium text-zinc-800">{{ deployText }}</p>
        </div>
        <p class="mt-2 text-xs leading-relaxed text-zinc-500">
          Rules are saved to your site’s repository, then published as Cloudflare’s native
          <code class="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px]">_redirects</code> file when
          the site rebuilds (usually a minute or two).
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span><strong class="font-semibold text-zinc-700">{{ activeCount }}</strong> active</span>
          <span v-if="invalidCount > 0" class="text-rose-600">
            <strong class="font-semibold">{{ invalidCount }}</strong> invalid (skipped by the build)
          </span>
          <span v-if="nearCeiling">
            {{ activeCount }} / {{ RULE_CEILING.toLocaleString() }} (Cloudflare Pages limit)
          </span>
        </div>
      </section>

      <div v-if="loading" class="text-sm text-zinc-400">Loading…</div>

      <!-- Rules table -->
      <div v-else class="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr class="border-b border-zinc-100 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <th class="w-14 px-2 py-2"></th>
              <th class="px-2 py-2">From</th>
              <th class="px-2 py-2">To</th>
              <th class="w-44 px-2 py-2">Status</th>
              <th class="w-8 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(r, i) in rows" :key="i">
              <tr :class="diagnostics[i].error ? 'bg-rose-50/40' : ''">
                <td class="px-2 py-1.5 align-top">
                  <div class="flex items-center gap-0.5 pt-0.5">
                    <button :class="iconBtn" :disabled="i === 0" title="Move up" @click="move(i, -1)">↑</button>
                    <button :class="iconBtn" :disabled="i === rows.length - 1" title="Move down" @click="move(i, 1)">↓</button>
                  </div>
                </td>
                <td class="px-2 py-1.5 align-top">
                  <input
                    v-model="r.from"
                    :class="[cellInput, diagnostics[i].error ? 'border-rose-300' : '']"
                    placeholder="/old-path"
                    spellcheck="false"
                    autocapitalize="off"
                    @input="markDirty"
                  />
                </td>
                <td class="px-2 py-1.5 align-top">
                  <input
                    v-model="r.to"
                    :class="[cellInput, diagnostics[i].error ? 'border-rose-300' : '']"
                    placeholder="/new-path or https://…"
                    spellcheck="false"
                    autocapitalize="off"
                    @input="markDirty"
                  />
                </td>
                <td class="px-2 py-1.5 align-top">
                  <select
                    v-model.number="r.status"
                    class="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400"
                    @change="markDirty"
                  >
                    <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ STATUS_LABELS[s] }}</option>
                  </select>
                </td>
                <td class="px-2 py-1.5 align-top">
                  <button :class="iconBtn" title="Delete" @click="removeRow(i)">✕</button>
                </td>
              </tr>
              <!-- Per-row diagnostics -->
              <tr v-if="diagnostics[i].error || diagnostics[i].warnings.length" class="border-b border-zinc-50">
                <td></td>
                <td colspan="4" class="px-2 pb-2">
                  <p v-if="diagnostics[i].error" class="text-xs text-rose-600">
                    {{ diagnostics[i].error }} <span class="text-rose-400">The build will skip this rule.</span>
                  </p>
                  <p
                    v-for="(w, wi) in diagnostics[i].warnings"
                    :key="wi"
                    class="text-xs text-amber-600"
                  >
                    {{ w }}
                  </p>
                </td>
              </tr>
            </template>

            <tr v-if="rows.length === 0">
              <td colspan="5" class="px-3 py-6 text-center text-sm text-zinc-400">
                No redirects yet.
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Inline add row -->
        <div class="border-t border-zinc-100 px-2 py-2">
          <button
            class="rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900"
            @click="addRow"
          >
            + Add redirect
          </button>
        </div>
      </div>
    </main>
  </div>
</template>
