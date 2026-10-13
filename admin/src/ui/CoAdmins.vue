<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
type Deployment = { id: string; stage: string; status: string; environment: string };
const configured = ref(false), ready = ref(false), busy = ref(false), loaded = ref(false);
const account = ref(""), project = ref(""), token = ref(""), username = ref("");
const logins = ref<string[]>([]), active = ref<string[]>([]), revision = ref("");
const error = ref(""), notice = ref(""), deployment = ref<Deployment | null>(null), retry = ref(false);
const dirty = computed(() => logins.value.join(",") !== revision.value);
async function call(action: string, extra: Record<string, unknown> = {}) {
  const response = await fetch("/admin/api/people", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra, ...(!configured.value ? { connection: { account: account.value.trim(), project: project.value.trim(), token: token.value.trim() } } : {}) }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not manage co-admins."); return result;
}
async function run(work: () => Promise<void>) {
  busy.value = true; error.value = "";
  try { await work(); } catch (reason) { error.value = reason instanceof Error ? reason.message : "Could not manage co-admins."; }
  finally { busy.value = false; }
}
async function load() {
  await run(async () => { const result = await call("read"); logins.value = result.logins; revision.value = result.revision; loaded.value = true; notice.value = ""; deployment.value = null; retry.value = false; });
}
onMounted(async () => {
  await run(async () => {
    const response = await fetch("/admin/api/people", { cache: "no-store" }); const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load co-admins.");
    configured.value = result.configured; active.value = result.active; project.value = result.project; ready.value = true;
  });
  if (ready.value && configured.value) await load();
});
function add() {
  const login = username.value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(login) || login.includes("--")) { error.value = "Enter a GitHub username without @."; return; }
  if (!logins.value.includes(login)) logins.value.push(login);
  username.value = ""; error.value = "";
}
async function save(action = "save") {
  await run(async () => {
    const result = await call(action, { logins: logins.value, expectedRevision: revision.value });
    revision.value = result.revision; logins.value = result.logins; deployment.value = result.deployment; retry.value = !result.deployment;
    notice.value = result.warning || "Co-admins saved. Deployment started; access changes when it succeeds.";
  });
}
async function check() {
  await run(async () => {
    const result = await call("status", { deploymentId: deployment.value!.id }); deployment.value = result.deployment;
    const d = result.deployment;
    if (d.environment === "production" && d.stage === "deploy" && d.status === "success") {
      notice.value = "Deployment succeeded. Refresh the CMS to check active co-admin access.";
    } else if (["failure", "canceled"].includes(d.status)) { notice.value = "Deployment failed or was canceled. Saved co-admin changes are not active. Retry deployment."; retry.value = true; }
    else notice.value = `Deployment ${d.stage || "queued"}: ${d.status || "pending"}. Access changes when deployment succeeds.`;
  });
}
</script>
<template>
  <section class="mb-10" data-lanza-origin="agent">
    <h2 class="mb-1 text-sm font-semibold text-zinc-900">Co-admins</h2>
    <p class="mb-3 text-sm text-zinc-600">Co-admins can publish, change site settings, update software and connect agents. They must also have GitHub write access. Only repository administrators can manage this list.</p>
    <p class="mb-3 text-sm">Active on this deployment: {{ active.join(', ') || 'None' }}</p>
    <form v-if="ready && !configured" class="card p-4 mb-4 space-y-3" @submit.prevent="load">
      <p class="text-sm">Connect Cloudflare to manage co-admins here. Use an API token with Account → Cloudflare Pages → Edit for this site's account. The token stays in this tab until you leave; Lanza does not save it.</p>
      <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener" class="text-sm underline">Create a Cloudflare API token</a>
      <label class="block text-sm">Cloudflare account ID<input v-model="account" class="input w-full" required :disabled="busy" autocomplete="off" /></label>
      <label class="block text-sm">Pages project name<input v-model="project" class="input w-full" required :disabled="busy" autocomplete="off" /></label>
      <label class="block text-sm">Cloudflare API token<input v-model="token" class="input w-full" type="password" required :disabled="busy" autocomplete="off" /></label>
      <button class="btn btn-primary" :disabled="busy">{{ loaded ? 'Reload co-admins' : 'Connect Cloudflare' }}</button>
    </form>
    <template v-if="loaded">
      <ul class="card mb-3 divide-y divide-[var(--border)]">
        <li v-for="login in logins" :key="login" class="flex justify-between items-center p-3"><span>{{ login }}</span><button type="button" class="btn btn-ghost" :disabled="busy" :aria-label="`Remove ${login}`" @click="logins = logins.filter(item => item !== login)">Remove</button></li>
        <li v-if="!logins.length" class="p-3 text-sm text-zinc-500">No co-admins selected.</li>
      </ul>
      <form class="flex gap-2 mb-3" @submit.prevent="add"><label class="flex-1 text-sm">GitHub username<input v-model="username" class="input w-full" :disabled="busy" autocomplete="off" /></label><button class="btn btn-ghost self-end" :disabled="busy || !username.trim() || logins.length >= 50">Add co-admin</button></form>
      <p class="text-sm text-zinc-600 mb-3">Saving starts a production deployment from the current production branch. Removing a co-admin here takes effect after deployment; removing their GitHub access takes effect within a minute.</p>
      <p v-if="dirty" class="mb-3 text-sm">Unsaved co-admin changes.</p>
      <div class="flex flex-wrap gap-2"><button class="btn btn-primary" :disabled="busy" @click="save()">Save and deploy</button><button v-if="configured" class="btn btn-ghost" :disabled="busy" @click="load">Reload co-admins</button><button v-if="deployment" class="btn btn-ghost" :disabled="busy" @click="check">Check deployment</button><button v-if="retry" class="btn btn-ghost" :disabled="busy || dirty" @click="save('deploy')">Retry deployment</button></div>
      <p class="mt-3 text-sm text-zinc-500">An optional separate OAuth Worker still needs its own matching co-admin setting.</p>
    </template>
    <p v-if="busy" role="status" class="mt-3 text-sm">Working…</p>
    <p v-if="notice" role="status" class="mt-3 text-sm">{{ notice }}</p>
    <p v-if="error" role="alert" class="mt-3 text-sm text-red-700">{{ error }}</p>
  </section>
</template>
