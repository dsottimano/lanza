<script setup lang="ts">
import { ref, shallowRef, useTemplateRef } from "vue";
import LoginView from "./ui/LoginView.vue";
import PostList from "./ui/PostList.vue";
import EditorView from "./ui/EditorView.vue";
import { GitHubClient } from "./backend/github";
import { getToken, clearToken } from "./backend/auth";

type View = "login" | "list" | "edit";

const client = shallowRef<GitHubClient | null>(null);
const login = ref("");
const view = ref<View>("login");
const editingPath = ref<string | null>(null);
const listRef = useTemplateRef<InstanceType<typeof PostList>>("listRef");

// Resume an existing session if a token is already stored.
const existing = getToken();
if (existing) {
  client.value = new GitHubClient(existing);
  view.value = "list";
}

function onAuthed(who: string) {
  login.value = who;
  client.value = new GitHubClient(getToken()!);
  view.value = "list";
}

function openPost(path: string) {
  editingPath.value = path;
  view.value = "edit";
}

function newPost() {
  editingPath.value = null;
  view.value = "edit";
}

function backToList(changed: boolean) {
  view.value = "list";
  if (changed) listRef.value?.reload();
}

function signOut() {
  clearToken();
  client.value = null;
  view.value = "login";
}
</script>

<template>
  <LoginView v-if="view === 'login'" @authed="onAuthed" />

  <template v-else-if="client">
    <div v-if="view === 'list'" class="app">
      <header class="topbar">
        <span class="brand">Studio</span>
        <button class="signout" @click="signOut">Sign out</button>
      </header>
      <PostList ref="listRef" :client="client" @open="openPost" @new="newPost" />
    </div>

    <EditorView
      v-else
      :key="editingPath ?? 'new'"
      :client="client"
      :path="editingPath"
      @back="backToList"
    />
  </template>
</template>

<style scoped>
.app {
  min-height: 100vh;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
}
.brand {
  font-weight: 650;
  letter-spacing: -0.01em;
}
.signout {
  border: none;
  background: none;
  color: #888;
  font-size: 0.85rem;
  cursor: pointer;
}
</style>
