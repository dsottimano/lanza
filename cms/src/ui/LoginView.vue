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
  <div class="login">
    <div class="card">
      <h1>Studio</h1>
      <p class="sub">
        Sign in with a GitHub fine-grained token (Contents: read &amp; write on
        <code>{{ REPO.owner }}/{{ REPO.name }}</code>).
      </p>
      <input
        v-model="token"
        type="password"
        placeholder="github_pat_…"
        autocomplete="off"
        @keydown.enter="signIn"
      />
      <button :disabled="busy || !token" @click="signIn">
        {{ busy ? "Checking…" : "Sign in" }}
      </button>
      <p v-if="error" class="err">{{ error }}</p>
      <a
        class="help"
        href="https://github.com/settings/personal-access-tokens"
        target="_blank"
        rel="noreferrer"
        >Create a token →</a
      >
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
}
.card {
  width: 100%;
  max-width: 24rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
h1 {
  font-family: Georgia, serif;
  font-size: 2rem;
  margin: 0;
}
.sub {
  margin: 0;
  color: #777;
  font-size: 0.92rem;
  line-height: 1.5;
}
code {
  font-size: 0.85em;
  background: #f3f3f1;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
}
input {
  padding: 0.6rem 0.7rem;
  border: 1px solid #ddd;
  border-radius: 7px;
  font: inherit;
}
button {
  padding: 0.6rem;
  border: none;
  border-radius: 7px;
  background: #1a1a1a;
  color: #fff;
  font-weight: 550;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.err {
  margin: 0;
  color: #c0392b;
  font-size: 0.82rem;
  word-break: break-word;
}
.help {
  font-size: 0.85rem;
  color: #777;
}
</style>
