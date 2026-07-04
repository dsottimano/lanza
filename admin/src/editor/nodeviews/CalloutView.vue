<script setup lang="ts">
import { type NodeViewProps, NodeViewWrapper, NodeViewContent } from "@tiptap/vue-3";

const props = defineProps<NodeViewProps>();

function changeEmoji() {
  const next = window.prompt("Emoji for this callout", props.node.attrs.emoji);
  if (next) props.updateAttributes({ emoji: next.trim().slice(0, 4) });
}
</script>

<template>
  <NodeViewWrapper class="callout" data-callout>
    <button class="callout-emoji" contenteditable="false" @click="changeEmoji">
      {{ node.attrs.emoji }}
    </button>
    <NodeViewContent class="callout-body" />
  </NodeViewWrapper>
</template>

<style scoped>
.callout {
  display: flex;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  margin: 1.4em 0;
  background: var(--surface);
  border-radius: 8px;
  border: 1px solid var(--border);
}
.callout-emoji {
  flex: 0 0 auto;
  font-size: 1.2rem;
  line-height: 1.5;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  user-select: none;
}
.callout-body {
  flex: 1;
  min-width: 0;
}
</style>
