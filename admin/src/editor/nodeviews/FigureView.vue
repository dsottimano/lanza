<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { type NodeViewProps, NodeViewWrapper, NodeViewContent } from "@tiptap/vue-3";
import { safeImageUrl } from "../url";
import { CLIENT_KEY } from "../../fields/context";
import { useImageUpload } from "../../fields/useImageUpload";

const props = defineProps<NodeViewProps>();
const client = inject(CLIENT_KEY);
const { uploading, pick } = useImageUpload(client);

const safeSrc = computed(() => safeImageUrl(props.node.attrs.src));
const error = ref("");

function setAlt() {
  const next = window.prompt("Alt text (describe the image for screen readers)", props.node.attrs.alt || "");
  if (next !== null) props.updateAttributes({ alt: next.trim() });
}

function onPick(e: Event) {
  error.value = "";
  pick(
    e,
    (url) => props.updateAttributes({ src: url }),
    (err) => (error.value = err instanceof Error ? err.message : "Upload failed."),
  );
}
</script>

<template>
  <NodeViewWrapper class="figure" data-drag-handle>
    <template v-if="safeSrc">
      <img :src="safeSrc" :alt="node.attrs.alt" contenteditable="false" />
      <button class="figure-alt" contenteditable="false" @click="setAlt">
        {{ node.attrs.alt ? "Alt: " + node.attrs.alt : "+ Add alt text" }}
      </button>
    </template>
    <div v-else class="figure-empty" contenteditable="false">
      <span class="figure-emoji">🖼️</span>
      <div class="figure-actions">
        <label class="figure-btn" :class="{ busy: uploading }">
          {{ uploading ? "Uploading…" : "Upload image" }}
          <input type="file" accept="image/*" :disabled="uploading" @change="onPick" />
        </label>
      </div>
      <small v-if="error" class="figure-error">{{ error }}</small>
    </div>
    <NodeViewContent class="figure-caption" as="figcaption" />
  </NodeViewWrapper>
</template>

<style scoped>
.figure {
  margin: 1.6em 0;
  text-align: center;
}
.figure img {
  max-width: 100%;
  border-radius: 6px;
}
.figure-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  padding: 2.2rem 1rem;
  border: 1px dashed #d0d0d0;
  border-radius: 10px;
  background: #fafafa;
}
.figure-emoji {
  font-size: 1.5rem;
}
.figure-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.9rem;
}
.figure-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.9rem;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  background: #fff;
  color: #3f3f46;
  cursor: pointer;
}
.figure-btn:hover {
  border-color: #a1a1aa;
}
.figure-btn.busy {
  opacity: 0.6;
  pointer-events: none;
}
.figure-btn input {
  display: none;
}
.figure-error {
  color: #c0392b;
  font-size: 0.78rem;
}
.figure-alt {
  display: inline-block;
  margin-top: 0.4em;
  border: none;
  background: none;
  color: #a1a1aa;
  cursor: pointer;
  font-size: 0.78rem;
  text-decoration: underline;
  text-underline-offset: 2px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.figure-alt:hover {
  color: #71717a;
}
.figure-caption {
  margin-top: 0.6em;
  font-size: 0.9rem;
  color: #8a8a8a;
  text-align: center;
}
.figure-caption:empty::before {
  content: "Type a caption…";
  color: #bbb;
}
</style>
