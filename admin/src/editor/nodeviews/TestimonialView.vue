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

function setAvatarUrl() {
  const next = window.prompt("Avatar image URL", props.node.attrs.avatar || "");
  if (next === null) return; // cancelled
  const url = safeImageUrl(next);
  if (!url) {
    window.alert("Enter a valid http(s) URL.");
    return;
  }
  props.updateAttributes({ avatar: url });
}

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
        <img
          class="avatar"
          :src="safeSrc"
          :alt="node.attrs.avatarAlt"
          title="Click to replace by URL"
          @click="setAvatarUrl"
        />
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
  border-left: 3px solid #1a1a1a;
  background: #faf9f7;
  border-radius: 8px;
}
.testimonial-quote {
  margin: 0;
  border: none;
  padding: 0;
  font-style: italic;
  font-size: 1.15em;
  color: #2a2a2a;
}
.testimonial-quote:empty::before {
  content: "Type the quote…";
  color: #bbb;
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
  cursor: pointer;
}
.avatar-add {
  display: grid;
  place-items: center;
  border: 1px dashed #c9c9c9;
  background: #fff;
  color: #9a9a9a;
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
  color: #1a1a1a;
}
.who-input::placeholder,
.role-input::placeholder {
  color: #bbb;
}
.role-input {
  font-size: 0.88rem;
  color: #8a8a8a;
}
.testimonial-error {
  grid-column: 1 / -1;
  color: #c0392b;
  font-size: 0.78rem;
}
</style>
