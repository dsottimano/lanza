<script setup lang="ts">
// Settings → Site Health. A friendly diagnostics dashboard: is the CMS talking
// to GitHub and Cloudflare, is the site deploying, and are the optional storage
// services (KV / D1 / R2) turned on and wired to this project. Non-technical
// editors get a plain-English status + one-click "Enable"/"Connect"; the
// technical detail lives behind each card's expander. All data + provisioning
// logic is in useHealthChecks; this file only renders it.
import { onMounted, reactive } from "vue";
import { GitHubClient } from "../backend/github";
import {
  useHealthChecks,
  SERVICE_META,
  SERVICE_KINDS,
  type ServiceKind,
} from "./useHealthChecks";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const {
  githubCard,
  cfApiCard,
  pagesCard,
  services,
  proxies,
  refreshing,
  refreshAll,
  enable,
  connect,
} = useHealthChecks(props.client);

// Which cards have their detail expanded.
const open = reactive<Record<string, boolean>>({});
const toggle = (id: string) => (open[id] = !open[id]);

type Level = "ok" | "warning" | "error" | "muted" | "loading";

const dotClass: Record<Level, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-rose-500",
  muted: "bg-zinc-300",
  loading: "bg-zinc-300 animate-pulse",
};

function pagesLevel(): Level {
  if (pagesCard.loading) return "loading";
  if (pagesCard.state === "notConfigured") return "muted";
  if (pagesCard.state === "error") return "error";
  if (pagesCard.deployStatus === "live") return "ok";
  if (pagesCard.deployStatus === "failed") return "error";
  if (pagesCard.deployStatus === "building") return "warning";
  return "warning";
}

function serviceLevel(kind: ServiceKind): Level {
  const s = services[kind];
  if (s.loading) return "loading";
  if (s.state === "connected") return "ok";
  if (s.state === "found") return "warning";
  if (s.state === "error") return "error";
  return "muted"; // off / notConfigured
}

function onEnable(kind: ServiceKind): void {
  const meta = SERVICE_META[kind];
  const name = `${pagesCard.projectName}-${meta.suffix}`;
  const ok = window.confirm(
    `Turn on ${meta.label}?\n\n` +
      `This creates a new resource named "${name}" on your Cloudflare account and ` +
      `connects it to this site. It stays on Cloudflare's free tier — you won't be charged.`,
  );
  if (ok) enable(kind);
}

function onConnect(kind: ServiceKind): void {
  const meta = SERVICE_META[kind];
  const ok = window.confirm(
    `Connect the existing ${meta.label} to this site?\n\n` +
      `This links the resource already on your account to this project (nothing new is created).`,
  );
  if (ok) connect(kind);
}

// Run every check in parallel as soon as the page opens.
onMounted(refreshAll);
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <div class="flex items-center gap-4">
        <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
        <span class="text-sm font-semibold text-zinc-900">Site Health</span>
      </div>
      <button
        class="btn btn-primary text-xs"
        :disabled="refreshing"
        @click="refreshAll"
      >
        {{ refreshing ? "Checking…" : "Refresh all" }}
      </button>
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Site Health</h1>
      <p class="mb-8 text-sm text-zinc-600">
        A quick read on how your site is connected and what's turned on. Green means good;
        amber needs a look; red needs fixing.
      </p>

      <!-- ── Connections ─────────────────────────────────────────────── -->
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-600">Connections</h2>
      <div class="space-y-3">
        <!-- GitHub -->
        <section class="card p-5">
          <div class="flex items-start gap-3">
            <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" :class="dotClass[githubCard.loading ? 'loading' : githubCard.state === 'ok' ? 'ok' : 'error']" />
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-3">
                <h3 class="font-semibold text-zinc-900">Content storage (GitHub)</h3>
              </div>
              <p class="mt-0.5 text-sm text-zinc-600">
                {{ githubCard.loading ? "Checking…" : githubCard.summary }}
              </p>
              <button
                v-if="!githubCard.loading && githubCard.state === 'error'"
                class="mt-2 text-xs font-medium text-zinc-500 underline-offset-2 hover:underline"
                @click="toggle('gh')"
              >
                {{ open.gh ? "Hide" : "How to fix" }}
              </button>
              <div v-if="open.gh && githubCard.state === 'error'" class="mt-2 rounded-lg bg-[var(--surface)] p-3 text-xs text-zinc-600">
                <p v-if="githubCard.authIssue">
                  The server-side <code class="rounded bg-zinc-200 px-1">GITHUB_TOKEN</code> is missing or
                  expired. Check the Pages project's secrets (Settings → Variables &amp; Secrets) and set a
                  fine-grained token with <strong>Contents: read &amp; write</strong> on this repo. For local
                  dev, put it in <code class="rounded bg-zinc-200 px-1">admin/.env</code>.
                </p>
                <p v-else>The GitHub proxy returned an unexpected error. See detail below.</p>
                <p class="mt-2 font-mono text-[11px] text-zinc-500">{{ githubCard.detail }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- Cloudflare API -->
        <section class="card p-5">
          <div class="flex items-start gap-3">
            <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" :class="dotClass[cfApiCard.loading ? 'loading' : cfApiCard.state === 'ok' ? 'ok' : cfApiCard.state === 'notConfigured' ? 'muted' : 'error']" />
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold text-zinc-900">Cloudflare connection</h3>
              <p class="mt-0.5 text-sm text-zinc-600">
                {{ cfApiCard.loading ? "Checking…" : cfApiCard.summary }}
              </p>

              <!-- Not-set-up: show the setup guide -->
              <button
                v-if="!cfApiCard.loading && cfApiCard.state === 'notConfigured'"
                class="mt-2 text-xs font-medium text-zinc-500 underline-offset-2 hover:underline"
                @click="toggle('cf')"
              >
                {{ open.cf ? "Hide setup steps" : "Set it up" }}
              </button>
              <div v-if="open.cf && cfApiCard.state === 'notConfigured'" class="mt-2 rounded-lg bg-[var(--surface)] p-3 text-xs text-zinc-600">
                <p class="mb-2">
                  Connecting Cloudflare lets this page turn storage services on and off for you. To set it up:
                </p>
                <ol class="ml-4 list-decimal space-y-1.5">
                  <li>
                    In the Cloudflare dashboard, create an <strong>API token</strong> with these permissions:
                    <span class="font-medium">Workers KV Storage: Edit</span>,
                    <span class="font-medium">D1: Edit</span>,
                    <span class="font-medium">Workers R2 Storage: Edit</span>, and
                    <span class="font-medium">Cloudflare Pages: Edit</span>.
                  </li>
                  <li>
                    Add these as secrets on this Pages project (Settings → Variables &amp; Secrets):
                    <code class="rounded bg-zinc-200 px-1">CLOUDFLARE_API_TOKEN</code>,
                    <code class="rounded bg-zinc-200 px-1">CLOUDFLARE_ACCOUNT_ID</code>,
                    <code class="rounded bg-zinc-200 px-1">PAGES_PROJECT</code>.
                  </li>
                  <li>
                    For local development, put the same three in
                    <code class="rounded bg-zinc-200 px-1">admin/.env</code>.
                  </li>
                </ol>
                <p v-if="cfApiCard.missing.length" class="mt-2 rounded bg-amber-50 px-2 py-1.5 text-amber-900">
                  Currently missing on the server: <strong>{{ cfApiCard.missing.join(", ") }}</strong>.
                </p>
              </div>

              <!-- Ok / error detail -->
              <button
                v-if="!cfApiCard.loading && cfApiCard.state !== 'notConfigured'"
                class="mt-2 text-xs font-medium text-zinc-500 underline-offset-2 hover:underline"
                @click="toggle('cf')"
              >
                {{ open.cf ? "Hide detail" : "Detail" }}
              </button>
              <div v-if="open.cf && cfApiCard.state !== 'notConfigured'" class="mt-2 rounded-lg bg-[var(--surface)] p-3 text-xs">
                <p class="font-mono text-[11px] text-zinc-500">{{ cfApiCard.detail }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- Pages project -->
        <section class="card p-5">
          <div class="flex items-start gap-3">
            <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" :class="dotClass[pagesLevel()]" />
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold text-zinc-900">Site deployment (Cloudflare Pages)</h3>
              <p class="mt-0.5 text-sm text-zinc-600">
                {{ pagesCard.loading ? "Checking…" : pagesCard.summary }}
              </p>
              <div v-if="!pagesCard.loading && pagesCard.state === 'ok'" class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span v-if="pagesCard.productionBranch">Branch: <span class="font-medium text-zinc-700">{{ pagesCard.productionBranch }}</span></span>
                <a
                  v-if="pagesCard.deployUrl"
                  :href="pagesCard.deployUrl"
                  target="_blank"
                  rel="noopener"
                  class="font-medium text-zinc-700 underline-offset-2 hover:underline"
                >View latest deployment ↗</a>
              </div>

              <button
                v-if="!pagesCard.loading && pagesCard.detail"
                class="mt-2 text-xs font-medium text-zinc-500 underline-offset-2 hover:underline"
                @click="toggle('pages')"
              >
                {{ open.pages ? "Hide detail" : "Detail" }}
              </button>
              <div v-if="open.pages && pagesCard.detail" class="mt-2 rounded-lg bg-[var(--surface)] p-3 text-xs">
                <p class="font-mono text-[11px] text-zinc-500">{{ pagesCard.detail }}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- ── Services ────────────────────────────────────────────────── -->
      <h2 class="mb-3 mt-8 text-xs font-semibold uppercase tracking-wide text-zinc-600">Storage services</h2>
      <div class="space-y-3">
        <section
          v-for="kind in SERVICE_KINDS"
          :key="kind"
          class="card p-5"
        >
          <div class="flex items-start gap-3">
            <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" :class="dotClass[serviceLevel(kind)]" />
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="font-semibold text-zinc-900">{{ SERVICE_META[kind].label }}</h3>
                  <p class="mt-0.5 text-xs text-zinc-500">{{ SERVICE_META[kind].blurb }}</p>
                </div>

                <!-- State label + action -->
                <div class="shrink-0 text-right">
                  <template v-if="services[kind].loading">
                    <span class="text-xs text-zinc-500">Checking…</span>
                  </template>
                  <template v-else-if="services[kind].busy">
                    <span class="text-xs text-zinc-500">Working…</span>
                  </template>
                  <template v-else-if="services[kind].state === 'notConfigured'">
                    <span class="text-xs text-zinc-500">Set up the Cloudflare connection first</span>
                  </template>
                  <template v-else-if="services[kind].state === 'connected'">
                    <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">Connected</span>
                  </template>
                  <template v-else-if="services[kind].state === 'found'">
                    <div class="flex flex-col items-end gap-1.5">
                      <span class="text-xs font-medium text-amber-700">Found, not connected</span>
                      <button
                        class="btn btn-primary text-xs"
                        @click="onConnect(kind)"
                      >Connect</button>
                    </div>
                  </template>
                  <template v-else-if="services[kind].state === 'error'">
                    <span class="text-xs font-medium text-rose-600">Error</span>
                  </template>
                  <template v-else>
                    <div class="flex flex-col items-end gap-1.5">
                      <span class="text-xs text-zinc-500">Off</span>
                      <button
                        class="btn btn-primary text-xs"
                        @click="onEnable(kind)"
                      >Enable</button>
                    </div>
                  </template>
                </div>
              </div>

              <button
                v-if="!services[kind].loading"
                class="mt-2 text-xs font-medium text-zinc-500 underline-offset-2 hover:underline"
                @click="toggle('svc-' + kind)"
              >
                {{ open['svc-' + kind] ? "Hide detail" : "Detail" }}
              </button>
              <div v-if="open['svc-' + kind]" class="mt-2 space-y-2 rounded-lg bg-[var(--surface)] p-3 text-xs text-zinc-600">
                <p v-if="services[kind].state === 'connected'">
                  Binding <code class="rounded bg-zinc-200 px-1">{{ services[kind].bindingName }}</code>
                  → <span class="font-medium">{{ services[kind].resourceName }}</span>
                  <span v-if="services[kind].resourceId" class="font-mono text-[11px] text-zinc-500"> ({{ services[kind].resourceId }})</span>
                </p>
                <p v-else-if="services[kind].state === 'found' && services[kind].resourceName">
                  Resource <span class="font-medium">{{ services[kind].resourceName }}</span> exists on your
                  account but isn't wired to this site. Connect it to bind it as
                  <code class="rounded bg-zinc-200 px-1">{{ services[kind].bindingName }}</code>.
                </p>
                <p v-if="services[kind].state === 'error'" class="font-mono text-[11px] text-rose-500">{{ services[kind].detail }}</p>
                <p class="text-[11px] text-zinc-500">
                  Turning a service on is free-tier, but reads and writes have daily limits — the public
                  site should avoid querying these on every page view.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- ── API status ──────────────────────────────────────────────── -->
      <h2 class="mb-3 mt-8 text-xs font-semibold uppercase tracking-wide text-zinc-600">API status</h2>
      <div class="card p-5 text-sm">
        <div class="flex items-center justify-between py-1">
          <span class="text-zinc-600">GitHub proxy <code class="text-xs text-zinc-500">/admin/api/gh</code></span>
          <span class="inline-flex items-center gap-2">
            <span class="h-2 w-2 rounded-full" :class="dotClass[proxies.gh === null ? 'loading' : proxies.gh ? 'ok' : 'error']" />
            <span class="text-xs text-zinc-500">{{ proxies.gh === null ? "…" : proxies.gh ? "Reachable" : "Unreachable" }}</span>
          </span>
        </div>
        <div class="flex items-center justify-between py-1">
          <span class="text-zinc-600">Cloudflare proxy <code class="text-xs text-zinc-500">/admin/api/cf</code></span>
          <span class="inline-flex items-center gap-2">
            <span class="h-2 w-2 rounded-full" :class="dotClass[proxies.cf === null ? 'loading' : proxies.cf ? 'ok' : 'error']" />
            <span class="text-xs text-zinc-500">{{ proxies.cf === null ? "…" : proxies.cf ? "Reachable" : "Unreachable" }}</span>
          </span>
        </div>
      </div>
    </main>
  </div>
</template>
