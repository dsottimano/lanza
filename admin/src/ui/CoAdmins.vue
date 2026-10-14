<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
const busy = ref(false), loaded = ref(false), username = ref("");
const logins = ref<string[]>([]), savedLogins = ref<string[]>([]), revision = ref("");
const error = ref(""), notice = ref(""), legacy = ref(false);
const dirty = computed(() => JSON.stringify([...logins.value].sort()) !== JSON.stringify([...savedLogins.value].sort()));
async function run(work: () => Promise<void>) {
  busy.value = true; error.value = ""; notice.value = "";
  try { await work(); } catch (reason) { error.value = reason instanceof Error ? reason.message : "Could not manage co-admins."; }
  finally { busy.value = false; }
}
function accept(result: { logins: string[]; revision: string; source: string }) {
  logins.value = [...result.logins]; savedLogins.value = [...result.logins]; revision.value = result.revision;
  legacy.value = result.source === "legacy"; loaded.value = true;
}
async function load() {
  await run(async () => {
    const response = await fetch("/admin/api/people", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load co-admins.");
    accept(result);
  });
}
onMounted(load);
function add() {
  const login = username.value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(login) || login.includes("--")) { error.value = "Enter a GitHub username without @."; return; }
  if (!logins.value.includes(login)) logins.value.push(login);
  username.value = ""; error.value = ""; notice.value = "";
}
async function save() {
  await run(async () => {
    const response = await fetch("/admin/api/people", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", logins: logins.value, expectedRevision: revision.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save co-admins.");
    accept(result); notice.value = "Co-admins saved. Access changes on the next request. Refresh the CMS to update its controls.";
  });
}
</script>
<template>
  <section class="mb-10" data-lanza-origin="agent">
    <h2 class="mb-1 text-sm font-semibold text-zinc-900">Co-admins</h2>
    <p class="mb-3 text-sm text-zinc-600">Co-admins can publish, change site settings, update software and connect agents. They must also have GitHub write access. Only repository administrators can manage this list.</p>
    <template v-if="loaded">
      <ul class="card mb-3 divide-y divide-[var(--border)]">
        <li v-for="login in logins" :key="login" class="flex justify-between items-center p-3"><span>{{ login }}</span><button type="button" class="btn btn-ghost" :disabled="busy" :aria-label="`Remove ${login}`" @click="logins = logins.filter(item => item !== login); notice = ''">Remove</button></li>
        <li v-if="!logins.length" class="p-3 text-sm text-zinc-500">No co-admins selected.</li>
      </ul>
      <form class="flex gap-2 mb-3" @submit.prevent="add"><label class="flex-1 text-sm">GitHub username<input v-model="username" class="input w-full" :disabled="busy" autocomplete="off" /></label><button class="btn btn-ghost self-end" :disabled="busy || !username.trim() || logins.length >= 50">Add co-admin</button></form>
      <p class="text-sm text-zinc-600 mb-3">Save to apply access changes. People need to refresh their CMS to see updated controls.</p>
      <p v-if="legacy && savedLogins.length" class="mb-3 text-sm">Your existing co-admins are listed here. Save to manage their access through GitHub.</p>
      <p v-if="dirty" class="mb-3 text-sm">Unsaved co-admin changes.</p>
      <div class="flex flex-wrap gap-2"><button class="btn btn-primary" :disabled="busy || (!dirty && !legacy)" @click="save">Save co-admins</button><button class="btn btn-ghost" :disabled="busy" @click="load">Reload co-admins</button></div>
    </template>
    <button v-else-if="!busy" class="btn btn-ghost" @click="load">Retry loading co-admins</button>
    <p v-if="busy" role="status" class="mt-3 text-sm">Working…</p>
    <p v-if="notice" role="status" class="mt-3 text-sm">{{ notice }}</p>
    <p v-if="error" role="alert" class="mt-3 text-sm text-red-700">{{ error }}</p>
  </section>
</template>
