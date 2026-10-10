<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { type NodeViewProps, NodeViewWrapper, NodeViewContent } from "@tiptap/vue-3";
import { safeImageUrl } from "../url";
import { CLIENT_KEY } from "../../fields/context";
import { useImageUpload } from "../../fields/useImageUpload";

const props = defineProps<NodeViewProps>();
const client = inject(CLIENT_KEY);
const { uploading, pick } = useImageUpload(client);

const safeSrc = computed(() => props.node.attrs.pastePreview || safeImageUrl(props.node.attrs.src));
const error = ref("");

async function pasteFromClipboard(event: MouseEvent) {
  const target = (event.currentTarget as HTMLElement).closest(".figure");
  error.value = "";
  try {
    if (!navigator.clipboard?.read) throw new Error("Clipboard access is unavailable. Click the image area and press Ctrl/Cmd+V.");
    const items = await navigator.clipboard.read();
    const data = new DataTransfer();
    for (const item of items) {
      const type = item.types.find(type => type.startsWith("image/"));
      if (type) data.items.add(new File([await item.getType(type)], "clipboard-image", { type }));
    }
    if (!data.files.length) throw new Error("No image found. Copy the image itself, then paste again.");
    if (target?.isConnected) target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  } catch (err) {
    error.value = err instanceof Error && err.name !== "NotAllowedError" ? err.message : "Clipboard access was blocked. Click the image area and press Ctrl/Cmd+V.";
  }
}

function removeImage() {
  props.deleteNode();
  props.editor.commands.focus();
}

function setAlt() {
  const next = window.prompt("Alt text (describe the image for screen readers)", props.node.attrs.alt || "");
  if (next !== null) props.updateAttributes({ alt: next.trim() });
}

function onPick(e: Event) {
  const previous = props.node.attrs.src;
  error.value = "";
  pick(
    e,
    (url) => { if (props.node.attrs.src === previous) props.updateAttributes({ src: url }); },
    (err) => (error.value = err instanceof Error ? err.message : "Upload failed."),
  );
}
</script>

<template>
  <NodeViewWrapper class="figure" data-drag-handle>
    <div class="figure-tools" contenteditable="false">
      <button type="button" class="figure-remove" @click.stop="removeImage">Remove image</button>
    </div>
    <template v-if="safeSrc">
      <img :src="safeSrc" :alt="node.attrs.alt" contenteditable="false" />
      <button class="figure-alt" contenteditable="false" @click="setAlt">
        {{ node.attrs.alt ? "Alt: " + node.attrs.alt : "+ Add alt text" }}
      </button>
    </template>
    <div v-else class="figure-empty" contenteditable="false" tabindex="0" @click.self="($event.currentTarget as HTMLElement).focus()" @keydown.delete.prevent.stop="removeImage" aria-label="Image upload. Choose a file or paste an image.">
      <span class="figure-emoji">🖼️</span>
      <div class="figure-actions">
        <button type="button" class="figure-btn" @click.stop="pasteFromClipboard">Paste image</button>
        <label class="figure-btn" :class="{ busy: uploading }">
          {{ uploading ? "Uploading…" : "Upload image" }}
          <input type="file" accept="image/*" :disabled="uploading" @change="onPick" />
        </label>
      </div>
      <small>or paste an image (Ctrl/Cmd+V)</small>
      <small v-if="error" class="figure-error">{{ error }}</small>
    </div>
    <p v-if="node.attrs.pasteUploadId" class="figure-caption" role="status" contenteditable="false">Uploading pasted image…</p>
    <NodeViewContent class="figure-caption" as="figcaption" />
  </NodeViewWrapper>
</template>

<style scoped>
.figure-tools { display: flex; justify-content: flex-end; margin-bottom: .4rem; }
.figure-remove { background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: .4rem .65rem; font-size: .8rem; color: var(--ink-soft); cursor: pointer; }
.figure-remove:hover { color: #b42318; border-color: #b42318; }
.figure-empty:focus { outline: 2px solid var(--accent); outline-offset: 3px; }
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
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: var(--surface);
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
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--ink-soft);
  cursor: pointer;
}
.figure-btn:hover {
  border-color: var(--muted);
}
.figure-btn.busy {
  opacity: 0.6;
  pointer-events: none;
}
.figure-btn input {
  display: none;
}
.figure-error {
  color: #c1121f;
  font-size: 0.78rem;
}
.figure-alt {
  display: inline-block;
  margin-top: 0.4em;
  border: none;
  background: none;
  color: var(--muted);
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
  color: var(--ink);
}
.figure-caption {
  margin-top: 0.6em;
  font-size: 0.9rem;
  color: var(--muted);
  text-align: center;
}
.figure-caption:empty::before {
  content: "Type a caption…";
  color: var(--muted);
}
</style>
