<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
// Settings → Connect an agent. Authorize an AI agent (Claude, ChatGPT, Codex) to
// edit this site's content over MCP, and hand it the token.
//
// WHY A TOKEN AND NOT A LOGIN BUTTON. This site's MCP endpoint used to be an OAuth
// resource server with the Lanza broker as its authorization server, which gave
// agents a one-click popup — and gave the broker the standing ability to mint a
// credential for a site it had finished onboarding. That was removed on purpose
// (docs/release-plan.md). GitHub device flow is the secretless replacement, and it
// cannot be an authorization server: there is no redirect, and GitHub does not
// support PKCE. So the token is carried by the person, once, rather than brokered.
//
// The token is shown ONCE. Nothing stores it — not a cookie, not the repository,
// not us. Losing it costs one more authorization; keeping a copy of it costs more.
import { computed, ref } from "vue";
import { access } from "../backend/access";

defineEmits<{ (e: "back"): void }>();

type Step = "idle" | "waiting" | "done" | "error";

const step = ref<Step>("idle");
const userCode = ref("");
const verifyUrl = ref("https://github.com/login/device");
const token = ref("");
const expiring = ref(false);
const ready = ref(true);
const message = ref("");
const copied = ref(false);

const installUrl = "https://github.com/apps/lanza-agents/installations/new";
const mcpUrl = computed(() => `${window.location.origin}/api/mcp`);

let cancelled = false;

async function post(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(path, { method: "POST", headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && !body.status) {
    throw new Error(typeof body.message === "string" ? body.message : "GitHub could not be reached.");
  }
  return body;
}

function fail(text: string) {
  step.value = "error";
  message.value = text;
}

async function start() {
  cancelled = false;
  copied.value = false;
  token.value = "";
  message.value = "";
  try {
    const view = await post("/admin/api/auth/agent/start");
    userCode.value = String(view.userCode ?? "");
    if (view.verificationUri) verifyUrl.value = String(view.verificationUri);
    step.value = "waiting";
    void poll(Number(view.interval) || 5);
  } catch (e) {
    fail(e instanceof Error ? e.message : "Could not start the authorization.");
  }
}

async function poll(intervalSec: number) {
  let wait = Math.max(intervalSec, 5);
  // GitHub's device codes last 15 minutes; stop there rather than polling forever.
  const deadline = Date.now() + 15 * 60 * 1000;
  while (!cancelled && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    if (cancelled) return;
    let body: Record<string, unknown>;
    try {
      body = await post("/admin/api/auth/agent/poll");
    } catch (e) {
      fail(e instanceof Error ? e.message : "GitHub could not be reached.");
      return;
    }
    if (body.status === "pending") {
      // `slow_down` comes back as a longer interval; honour it or GitHub starts
      // refusing outright.
      wait = Math.max(Number(body.interval) || wait, wait);
      continue;
    }
    if (body.status === "ok") {
      token.value = String(body.token ?? "");
      expiring.value = Boolean(body.expiring);
      ready.value = body.ready !== false;
      step.value = "done";
      return;
    }
    if (body.status === "restart") {
      fail("That authorization expired. Start again.");
      return;
    }
    fail(
      body.error === "access_denied"
        ? "The authorization was declined on GitHub."
        : `GitHub refused the authorization (${String(body.error ?? "unknown")}).`,
    );
    return;
  }
  if (!cancelled) fail("That authorization expired. Start again.");
}

function cancel() {
  cancelled = true;
  step.value = "idle";
}

async function copy() {
  try {
    await navigator.clipboard.writeText(token.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div class="settings-page">
    <SettingsHeader title="Connect an agent" @back="$emit('back')">
      <template #description><p>
        Let Claude, ChatGPT or another agent read and edit this site's content directly.
        You authorize it once with your own GitHub account, then paste one token into the
        agent's settings. Nothing else holds a key to your site.
      </p></template>
    </SettingsHeader>

    <main class="settings-body">
      <!-- Step 1: install -->
      <section class="mb-8">
        <h2 class="mb-1 text-sm font-semibold text-zinc-900">1. Give the agent app access to this repository</h2>
        <p class="mb-3 max-w-prose text-sm text-zinc-600">
          A one-time install, on
          <code v-if="access.repo" class="rounded bg-zinc-100 px-1 py-0.5 text-[0.8em]">{{ access.repo }}</code>
          <span v-else>this site's repository</span>. It can read and write content there, and
          nothing else.
        </p>
        <a class="btn btn-ghost inline-flex px-4" :href="installUrl" target="_blank" rel="noopener">
          Install on GitHub
        </a>
      </section>

      <!-- Step 2: authorize -->
      <section class="mb-8">
        <h2 class="mb-1 text-sm font-semibold text-zinc-900">2. Authorize, and get the token</h2>

        <div v-if="step === 'idle'">
          <p class="mb-3 max-w-prose text-sm text-zinc-600">
            GitHub will show you a code to type. The token comes back here.
          </p>
          <button class="btn btn-primary px-4" @click="start">Get a token</button>
        </div>

        <div v-else-if="step === 'waiting'" class="card px-4 py-4">
          <p class="mb-2 text-sm text-zinc-600">Enter this code at GitHub:</p>
          <p class="mb-3 font-mono text-2xl tracking-[0.2em] text-zinc-900">{{ userCode }}</p>
          <a class="btn btn-primary inline-flex px-4" :href="verifyUrl" target="_blank" rel="noopener">
            Open GitHub
          </a>
          <p class="mt-3 text-sm text-zinc-500">Waiting for you to approve it…</p>
          <button class="mt-2 text-sm text-zinc-500 underline transition hover:text-zinc-900" @click="cancel">
            Cancel
          </button>
        </div>

        <div v-else-if="step === 'error'" class="card px-4 py-4">
          <p class="mb-3 text-sm text-red-700">{{ message }}</p>
          <button class="btn btn-ghost px-4" @click="start">Try again</button>
        </div>

        <div v-else class="card px-4 py-4">
          <p class="mb-2 text-sm font-medium text-zinc-900">Your token</p>
          <p class="mb-3 break-all rounded bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-900">
            {{ token }}
          </p>
          <div class="flex items-center gap-3">
            <button class="btn btn-primary px-4" @click="copy">
              {{ copied ? "Copied" : "Copy token" }}
            </button>
            <span class="text-sm text-zinc-500">Shown once. Nothing here stores it.</span>
          </div>

          <p v-if="!ready" class="mt-4 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <strong class="font-semibold">This token cannot reach the site yet.</strong>
            That usually means step 1 was skipped, or the install did not include this
            repository. Install it, then get a new token.
          </p>
          <p v-else-if="expiring" class="mt-4 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <strong class="font-semibold">This token expires in about 8 hours.</strong>
            The agent app is set to expire tokens, so it will need re-pasting. Turning that
            off on the GitHub app makes it permanent.
          </p>
        </div>
      </section>

      <!-- Step 3: paste -->
      <section class="mb-10">
        <h2 class="mb-1 text-sm font-semibold text-zinc-900">3. Add it to your agent</h2>
        <p class="mb-3 max-w-prose text-sm text-zinc-600">
          Add a remote MCP server with this address, and the token as a bearer token.
        </p>
        <p class="break-all rounded bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-900">{{ mcpUrl }}</p>
      </section>

      <aside class="border-l-2 border-zinc-400 bg-zinc-50 px-4 py-3">
        <p class="text-sm leading-relaxed text-zinc-700">
          <strong class="font-semibold">The token is you.</strong>
          It can edit and publish this site, because you can. It is good until you revoke
          it at
          <a
            class="underline"
            href="https://github.com/settings/applications"
            target="_blank"
            rel="noopener"
            >github.com/settings/applications</a
          >, which takes effect immediately. Treat it like a password: paste it into the
          agent, and nowhere else.
        </p>
      </aside>
    </main>
  </div>
</template>
