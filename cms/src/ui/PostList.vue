<script setup lang="ts">
import { onMounted, ref } from "vue";
import { GitHubClient, type PostEntry } from "../backend/github";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{
  (e: "open", path: string): void;
  (e: "new"): void;
}>();

const posts = ref<PostEntry[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    posts.value = (await props.client.listPosts()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load posts.";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
defineExpose({ reload: load });
</script>

<template>
  <div class="list">
    <div class="head">
      <h2>Posts</h2>
      <button class="new" @click="emit('new')">+ New post</button>
    </div>

    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!posts.length" class="muted">No posts yet.</p>

    <ul v-else>
      <li v-for="p in posts" :key="p.path">
        <button class="row" @click="emit('open', p.path)">
          <span class="name">{{ p.name }}</span>
          <span class="arrow">→</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.list {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2.5rem 1.25rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.2rem;
}
h2 {
  font-family: Georgia, serif;
  margin: 0;
}
.new {
  padding: 0.45rem 0.8rem;
  border: none;
  border-radius: 7px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.8rem 0.4rem;
  border: none;
  border-bottom: 1px solid #eee;
  background: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.row:hover {
  background: #fafafa;
}
.name {
  font-size: 1rem;
}
.arrow {
  color: #bbb;
}
.muted {
  color: #999;
}
.err {
  color: #c0392b;
  word-break: break-word;
}
</style>
