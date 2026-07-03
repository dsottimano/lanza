<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/vue-3";
import { safeImageUrl } from "../url";
import { CLIENT_KEY } from "../../fields/context";
import { useImageUpload } from "../../fields/useImageUpload";
import type { Logo } from "../extensions/LogoStrip";

const props = defineProps<NodeViewProps>();
const client = inject(CLIENT_KEY);
const { uploading, pick } = useImageUpload(client);
const error = ref("");

const logos = computed<Logo[]>(() => (props.node.attrs.logos as Logo[]) || []);

function commit(next: Logo[]) {
  props.updateAttributes({ logos: next });
}
function addUrl() {
  const url = window.prompt("Logo image URL");
  if (url === null) return; // cancelled
  const safe = safeImageUrl(url);
  if (!safe) {
    window.alert("Enter a valid http(s) URL.");
    return;
  }
  commit([...logos.value, { src: safe, alt: "" }]);
}
function onPick(e: Event) {
  error.value = "";
  pick(
    e,
    (url) => commit([...logos.value, { src: url, alt: "" }]),
    (err) => (error.value = err instanceof Error ? err.message : "Upload failed."),
  );
}
function remove(i: number) {
  commit(logos.value.filter((_, idx) => idx !== i));
}
</script>

<template>
  <NodeViewWrapper class="logo-strip-edit" data-drag-handle contenteditable="false">
    <div class="logos">
      <span v-for="(logo, i) in logos" :key="i" class="logo-cell">
        <img class="logo" :src="safeImageUrl(logo.src)" :alt="logo.alt" />
        <button class="logo-remove" title="Remove logo" @click="remove(i)">✕</button>
      </span>
      <div v-if="!logos.length" class="logo-empty">No logos yet — add your first below.</div>
    </div>
    <div class="logo-actions">
      <template v-if="client">
        <label class="logo-btn" :class="{ busy: uploading }">
          {{ uploading ? "Uploading…" : "Upload logo" }}
          <input type="file" accept="image/*" :disabled="uploading" @change="onPick" />
        </label>
        <button class="logo-link" @click="addUrl">or paste a URL</button>
      </template>
      <button v-else class="logo-btn" @click="addUrl">Add logo URL</button>
    </div>
    <small v-if="error" class="logo-error">{{ error }}</small>
  </NodeViewWrapper>
</template>

<style scoped>
.logo-strip-edit {
  margin: 1.8em 0;
  padding: 1.2rem;
  border: 1px dashed #e0e0e0;
  border-radius: 10px;
  background: #fafafa;
}
.logos {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1.4rem;
  min-height: 2.4rem;
}
.logo-cell {
  position: relative;
  display: inline-flex;
}
.logo {
  max-height: 2.4rem;
  width: auto;
  object-fit: contain;
}
.logo-remove {
  position: absolute;
  top: -0.55rem;
  right: -0.55rem;
  width: 1.2rem;
  height: 1.2rem;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 999px;
  background: #1a1a1a;
  color: #fff;
  font-size: 0.65rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.logo-cell:hover .logo-remove {
  opacity: 1;
}
.logo-empty {
  color: #9a9a9a;
  font-size: 0.9rem;
}
.logo-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 1rem;
  font-size: 0.9rem;
}
.logo-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.9rem;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  background: #fff;
  color: #3f3f46;
  cursor: pointer;
}
.logo-btn:hover {
  border-color: #a1a1aa;
}
.logo-btn.busy {
  opacity: 0.6;
  pointer-events: none;
}
.logo-btn input {
  display: none;
}
.logo-link {
  border: none;
  background: none;
  color: #8a8a8a;
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.logo-error {
  display: block;
  margin-top: 0.5rem;
  color: #c0392b;
  font-size: 0.78rem;
}
</style>
