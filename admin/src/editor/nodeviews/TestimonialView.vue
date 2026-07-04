<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { type NodeViewProps, NodeViewWrapper, NodeViewContent } from "@tiptap/vue-3";
import { safeImageUrl } from "../url";
import { CLIENT_KEY } from "../../fields/context";
import { useImageUpload } from "../../fields/useImageUpload";

const props = defineProps<NodeViewProps>();
const client = inject(CLIENT_KEY);
const { uploading, pick } = useImageUpload(client);

const safeSrc = computed(() => safeImageUrl(props.node.attrs.avatar));
const error = ref("");

function onPick(e: Event) {
  error.value = "";
  pick(
    e,
    (url) => props.updateAttributes({ avatar: url }),
    (err) => (error.value = err instanceof Error ? err.message : "Upload failed."),
  );
}
</script>

<template>
  <NodeViewWrapper class="testimonial" data-testimonial>
    <NodeViewContent class="testimonial-quote" as="blockquote" />
    <figcaption class="testimonial-foot" contenteditable="false">
      <template v-if="safeSrc">
        <img class="avatar" :src="safeSrc" :alt="node.attrs.avatarAlt" />
      </template>
      <label v-else class="avatar-add" :class="{ busy: uploading }" title="Add avatar">
        {{ uploading ? "…" : "＋" }}
        <input type="file" accept="image/*" :disabled="uploading || !client" @change="onPick" />
      </label>
      <span class="who">
        <input
          class="who-input"
          :value="node.attrs.author"
          placeholder="Name"
          @input="updateAttributes({ author: ($event.target as HTMLInputElement).value })"
        />
      </span>
      <span class="role">
        <input
          class="role-input"
          :value="node.attrs.role"
          placeholder="Role, Company"
          @input="updateAttributes({ role: ($event.target as HTMLInputElement).value })"
        />
      </span>
      <small v-if="error" class="testimonial-error">{{ error }}</small>
    </figcaption>
  </NodeViewWrapper>
</template>

<style scoped>
.testimonial {
  margin: 1.8em 0;
  padding: 1.4rem 1.6rem;
  border-left: 3px solid var(--ink);
  background: var(--surface);
  border-radius: 8px;
}
.testimonial-quote {
  margin: 0;
  border: none;
  padding: 0;
  font-style: italic;
  font-size: 1.15em;
  color: var(--ink);
}
.testimonial-quote:empty::before {
  content: "Type the quote…";
  color: var(--muted);
}
.testimonial-foot {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: "avatar who" "avatar role";
  align-items: center;
  gap: 0 0.7rem;
  margin-top: 0.9rem;
}
.avatar,
.avatar-add {
  grid-area: avatar;
  align-self: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
}
.avatar {
  object-fit: cover;
}
.avatar-add {
  display: grid;
  place-items: center;
  border: 1px dashed var(--border);
  background: #fff;
  color: var(--muted);
  cursor: pointer;
  font-size: 1rem;
}
.avatar-add.busy {
  opacity: 0.6;
  pointer-events: none;
}
.avatar-add input {
  display: none;
}
.who {
  grid-area: who;
}
.role {
  grid-area: role;
}
.who-input,
.role-input {
  border: none;
  background: none;
  font: inherit;
  padding: 0;
  outline: none;
  width: 100%;
}
.who-input {
  font-weight: 600;
  color: var(--ink);
}
.who-input::placeholder,
.role-input::placeholder {
  color: var(--muted);
}
.role-input {
  font-size: 0.88rem;
  color: var(--muted);
}
.testimonial-error {
  grid-column: 1 / -1;
  color: #c1121f;
  font-size: 0.78rem;
}
</style>
