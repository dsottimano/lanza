<script setup lang="ts">
import { type NodeViewProps, NodeViewWrapper, NodeViewContent } from "@tiptap/vue-3";

const props = defineProps<NodeViewProps>();

function setUrl() {
  const next = window.prompt("Image URL", props.node.attrs.src || "");
  if (next !== null) props.updateAttributes({ src: next.trim() });
}
</script>

<template>
  <NodeViewWrapper class="figure" data-drag-handle>
    <img
      v-if="node.attrs.src"
      :src="node.attrs.src"
      :alt="node.attrs.alt"
      contenteditable="false"
      @click="setUrl"
    />
    <button v-else class="figure-empty" contenteditable="false" @click="setUrl">
      🖼️ Add an image — click to set a URL
      <small>(uploads land in Phase 4)</small>
    </button>
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
  cursor: pointer;
}
.figure-empty {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
  padding: 2.5rem 1rem;
  border: 1px dashed #d0d0d0;
  border-radius: 8px;
  background: #fafafa;
  color: #8a8a8a;
  cursor: pointer;
  font-size: 0.95rem;
}
.figure-empty small {
  font-size: 0.78rem;
  opacity: 0.7;
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
