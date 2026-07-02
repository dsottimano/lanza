<script setup lang="ts">
import { computed, ref } from "vue";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/vue-3";
import { safeEmbedUrl } from "../url";

const props = defineProps<NodeViewProps>();

const draft = ref(props.node.attrs.src || "");
const error = ref("");

// Never bind a raw, unvalidated URL to the iframe — a `javascript:`/`data:` src
// would execute in the admin origin and could read the stored GitHub token.
const safeSrc = computed(() => safeEmbedUrl(props.node.attrs.src));

function apply() {
  const url = safeEmbedUrl(draft.value);
  if (!url) {
    error.value = "Enter a valid http(s) URL.";
    return;
  }
  error.value = "";
  props.updateAttributes({ src: url });
}
</script>

<template>
  <NodeViewWrapper class="embed" data-embed contenteditable="false">
    <iframe
      v-if="safeSrc"
      :src="safeSrc"
      loading="lazy"
      allowfullscreen
      frameborder="0"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
    />
    <div v-else class="embed-input">
      <span class="embed-label">🔗 Embed URL</span>
      <input
        v-model="draft"
        placeholder="https://…"
        @keydown.enter.prevent="apply"
      />
      <button @click="apply">Embed</button>
      <span v-if="error" class="embed-error">{{ error }}</span>
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
.embed-error {
  color: #c0392b;
  font-size: 0.8rem;
  white-space: nowrap;
}
</style>
