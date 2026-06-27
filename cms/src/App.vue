<script setup lang="ts">
import { ref, shallowRef, useTemplateRef } from "vue";
import LoginView from "./ui/LoginView.vue";
import Sidebar from "./ui/Sidebar.vue";
import CollectionList from "./ui/CollectionList.vue";
import EditorView from "./ui/EditorView.vue";
import RecordEditor from "./ui/RecordEditor.vue";
import SettingsView from "./ui/SettingsView.vue";
import { GitHubClient } from "./backend/github";
import { getToken, clearToken } from "./backend/auth";
import { getCollection, type FolderCollection, type FileEntry } from "./schema";

type Pane = "list" | "editRich" | "editRecord" | "settings";

const client = shallowRef<GitHubClient | null>(null);
const authed = ref(false);
const pane = ref<Pane>("list");
const collection = shallowRef<FolderCollection>(getCollection("posts") as FolderCollection);
const editingPath = ref<string | null>(null);
const settingsFile = shallowRef<FileEntry | null>(null);
const listRef = useTemplateRef<InstanceType<typeof CollectionList>>("listRef");

// Resume an existing session if a token is already stored.
const existing = getToken();
if (existing) {
  client.value = new GitHubClient(existing);
  authed.value = true;
}

function onAuthed() {
  client.value = new GitHubClient(getToken()!);
  authed.value = true;
}

function selectCollection(name: string) {
  collection.value = getCollection(name) as FolderCollection;
  settingsFile.value = null;
  editingPath.value = null;
  pane.value = "list";
}

function openSettings(file: FileEntry) {
  settingsFile.value = file;
  pane.value = "settings";
}

function openEntry(path: string) {
  editingPath.value = path;
  pane.value = collection.value.body === "rich" ? "editRich" : "editRecord";
}

function newEntry() {
  editingPath.value = null;
  pane.value = collection.value.body === "rich" ? "editRich" : "editRecord";
}

function backToList(changed: boolean) {
  pane.value = "list";
  if (changed) listRef.value?.reload();
}

function signOut() {
  clearToken();
  client.value = null;
  authed.value = false;
}
</script>

<template>
  <LoginView v-if="!authed" @authed="onAuthed" />

  <!-- The collection rail is permanent; only the main column swaps. -->
  <div v-else-if="client" class="flex min-h-screen bg-zinc-50">
    <Sidebar
      :active-collection="collection.name"
      :active-settings="pane === 'settings' ? (settingsFile?.name ?? null) : null"
      @select="selectCollection"
      @open-settings="openSettings"
      @signout="signOut"
    />
    <main class="min-w-0 flex-1">
      <EditorView
        v-if="pane === 'editRich'"
        :key="editingPath ?? 'new'"
        :client="client"
        :collection="collection"
        :path="editingPath"
        @back="backToList"
      />
      <RecordEditor
        v-else-if="pane === 'editRecord'"
        :key="editingPath ?? 'new'"
        :client="client"
        :collection="collection"
        :path="editingPath"
        @back="backToList"
      />
      <SettingsView
        v-else-if="pane === 'settings' && settingsFile"
        :key="settingsFile.name"
        :client="client"
        :file="settingsFile"
        @back="pane = 'list'"
      />
      <CollectionList
        v-else
        ref="listRef"
        :client="client"
        :collection="collection"
        @open="openEntry"
        @new="newEntry"
      />
    </main>
  </div>
</template>
