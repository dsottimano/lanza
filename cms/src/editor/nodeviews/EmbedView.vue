<script setup lang="ts">
import { ref } from "vue";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/vue-3";

const props = defineProps<NodeViewProps>();

const draft = ref(props.node.attrs.src || "");

function apply() {
  const url = draft.value.trim();
  if (url) props.updateAttributes({ src: url });
}
</script>

<template>
  <NodeViewWrapper class="embed" data-embed contenteditable="false">
    <iframe
      v-if="node.attrs.src"
      :src="node.attrs.src"
      loading="lazy"
      allowfullscreen
      frameborder="0"
    />
    <div v-else class="embed-input">
      <span class="embed-label">🔗 Embed URL</span>
      <input
        v-model="draft"
        placeholder="https://…"
        @keydown.enter.prevent="apply"
      />
      <button @click="apply">Embed</button>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.embed {
  margin: 1.6em 0;
}
.embed iframe {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  background: #000;
}
.embed-input {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 1rem;
  border: 1px dashed #d0d0d0;
  border-radius: 8px;
  background: #fafafa;
}
.embed-label {
  color: #8a8a8a;
  font-size: 0.9rem;
  white-space: nowrap;
}
.embed-input input {
  flex: 1;
  padding: 0.4rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 5px;
  font: inherit;
}
.embed-input button {
  padding: 0.4rem 0.8rem;
  border: none;
  border-radius: 5px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
}
</style>
