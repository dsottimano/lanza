<script setup lang="ts">
// Update the stored GitHub token without signing out. Validates the token
// (GET /user) before saving, so a bad token can't silently replace a good one.
import { ref } from "vue";
import { GitHubClient } from "../backend/github";
import { getToken, setToken } from "../backend/auth";
import { REPO } from "../backend/config";

const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved", token: string): void;
}>();

const token = ref(getToken() ?? "");
const reveal = ref(false);
const busy = ref(false);
const error = ref("");
const okMsg = ref("");

async function save() {
  const value = token.value.trim();
  if (!value) return;
  busy.value = true;
  error.value = "";
  okMsg.value = "";
  try {
    const login = await new GitHubClient(value).getLogin();
    setToken(value);
    okMsg.value = `Saved — signed in as ${login} ✓`;
    emit("saved", value);
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Token check failed — is it valid?";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-semibold text-zinc-900">GitHub token</h2>
        <button class="text-zinc-400 transition hover:text-zinc-900" @click="emit('close')">✕</button>
      </div>

      <p class="mb-4 text-sm leading-relaxed text-zinc-500">
        Fine-grained PAT with <strong>Contents: read &amp; write</strong> on
        <code class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.8em] text-zinc-700">{{ REPO.owner }}/{{ REPO.name }}</code>.
      </p>

      <div class="relative">
        <input
          v-model="token"
          :type="reveal ? 'text' : 'password'"
          placeholder="github_pat_…"
          autocomplete="off"
          spellcheck="false"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 pr-16 text-sm text-zinc-900 transition placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-900/5"
          @keydown.enter="save"
        />
        <button
          type="button"
          class="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs text-zinc-500 transition hover:text-zinc-900"
          @click="reveal = !reveal"
        >
          {{ reveal ? "Hide" : "Show" }}
        </button>
      </div>

      <p v-if="error" class="mt-3 break-words text-xs text-rose-600">{{ error }}</p>
      <p v-if="okMsg" class="mt-3 text-xs text-emerald-600">{{ okMsg }}</p>

      <div class="mt-5 flex items-center justify-between">
        <a
          class="text-sm text-zinc-500 underline-offset-2 transition hover:text-zinc-900 hover:underline"
          href="https://github.com/settings/personal-access-tokens"
          target="_blank"
          rel="noreferrer"
          >Create a token →</a
        >
        <div class="flex gap-2">
          <button
            class="rounded-lg px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100"
            @click="emit('close')"
          >
            {{ okMsg ? "Done" : "Cancel" }}
          </button>
          <button
            :disabled="busy || !token"
            class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-zinc-900"
            @click="save"
          >
            {{ busy ? "Checking…" : "Validate & save" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
