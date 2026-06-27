<script setup lang="ts">
import { ref } from "vue";
import { GitHubClient } from "../backend/github";
import { setToken } from "../backend/auth";
import { REPO } from "../backend/config";

const emit = defineEmits<{ (e: "authed", login: string): void }>();

const token = ref("");
const busy = ref(false);
const error = ref("");

async function signIn() {
  error.value = "";
  busy.value = true;
  try {
    const client = new GitHubClient(token.value.trim());
    const login = await client.getLogin();
    setToken(token.value);
    emit("authed", login);
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Sign-in failed — check the token.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-screen place-items-center bg-zinc-50 p-6">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <h1 class="font-serif text-4xl font-bold tracking-tight text-zinc-900">Studio</h1>
        <p class="mt-1 text-sm text-zinc-500">Your writing, in your repo.</p>
      </div>

      <div class="rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
        <p class="mb-5 text-sm leading-relaxed text-zinc-500">
          Sign in with a GitHub fine-grained token (Contents: read &amp; write on
          <code class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.8em] text-zinc-700">{{ REPO.owner }}/{{ REPO.name }}</code>).
        </p>

        <input
          v-model="token"
          type="password"
          placeholder="github_pat_…"
          autocomplete="off"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 transition placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-900/5"
          @keydown.enter="signIn"
        />

        <button
          :disabled="busy || !token"
          class="mt-3 w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-zinc-900"
          @click="signIn"
        >
          {{ busy ? "Checking…" : "Sign in" }}
        </button>

        <p v-if="error" class="mt-3 break-words text-xs text-rose-600">{{ error }}</p>

        <a
          class="mt-5 inline-block text-sm text-zinc-500 underline-offset-2 transition hover:text-zinc-900 hover:underline"
          href="https://github.com/settings/personal-access-tokens"
          target="_blank"
          rel="noreferrer"
          >Create a token →</a
        >
      </div>
    </div>
  </div>
</template>
