<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, shallowRef } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import type { GitHubClient } from "../backend/github";
import { CLIENT_KEY } from "../fields/context";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { BubbleMenuPlugin } from "@tiptap/extension-bubble-menu";
import { Callout } from "./extensions/Callout";
import { Figure } from "./extensions/Figure";
import { Embed } from "./extensions/Embed";
import { SlashCommand, filterSlashItems, type SlashItem } from "./extensions/slash";
import SlashMenu from "./SlashMenu.vue";
import { safeLinkUrl } from "./url";

const props = withDefaults(
  defineProps<{ initialHtml?: string; client?: GitHubClient }>(),
  { initialHtml: "<p></p>", client: undefined },
);
const emit = defineEmits<{ (e: "change"): void }>();

// Expose the client to node views (Figure upload). TipTap vue-3 mounts node
// views with this component's app context, so inject() reaches them here.
provide(CLIENT_KEY, props.client as GitHubClient);

const bubbleEl = ref<HTMLElement>();

// ── Slash menu reactive state (driven by the suggestion render callbacks) ──
const slashOpen = ref(false);
const slashItems = ref<SlashItem[]>([]);
const slashSelected = ref(0);
const slashTop = ref(0);
const slashLeft = ref(0);
const slashCommand = shallowRef<((item: SlashItem) => void) | null>(null);

function runSlash(index: number) {
  const item = slashItems.value[index];
  if (item && slashCommand.value) slashCommand.value(item);
}

const editor = useEditor({
  content: props.initialHtml,
  extensions: [
    StarterKit.configure({ link: false }),
    // `protocols` + `validate` pin link policy to our own allowlist (safeLinkUrl)
    // rather than relying on TipTap's defaults — pasted/autolinked/loaded hrefs
    // with a junk scheme (javascript:, data:, …) are dropped at parse time.
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ["http", "https", "mailto", "tel"],
      validate: (href) => !!safeLinkUrl(href),
    }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "paragraph"
          ? "Type / for commands, or just start writing…"
          : "",
    }),
    Callout,
    Figure,
    Embed,
    SlashCommand.configure({
      suggestion: {
        items: ({ query }) => filterSlashItems(query),
        render: () => ({
          onStart: (props) => {
            slashItems.value = props.items;
            slashSelected.value = 0;
            slashCommand.value = props.command;
            const r = props.clientRect?.();
            if (r) {
              slashTop.value = r.bottom + 6;
              slashLeft.value = r.left;
            }
            slashOpen.value = true;
          },
          onUpdate: (props) => {
            slashItems.value = props.items;
            slashCommand.value = props.command;
            slashSelected.value = Math.min(
              slashSelected.value,
              Math.max(0, props.items.length - 1),
            );
            const r = props.clientRect?.();
            if (r) {
              slashTop.value = r.bottom + 6;
              slashLeft.value = r.left;
            }
          },
          onKeyDown: (props) => {
            const n = slashItems.value.length;
            if (!n) return false; // empty list ("No matches") — avoid % 0 → NaN
            if (props.event.key === "ArrowDown") {
              slashSelected.value = (slashSelected.value + 1) % n;
              return true;
            }
            if (props.event.key === "ArrowUp") {
              slashSelected.value = (slashSelected.value - 1 + n) % n;
              return true;
            }
            if (props.event.key === "Enter") {
              runSlash(slashSelected.value);
              return true;
            }
            if (props.event.key === "Escape") {
              slashOpen.value = false;
              return true;
            }
            return false;
          },
          onExit: () => {
            slashOpen.value = false;
          },
        }),
      },
    }),
  ],
  onUpdate: () => emit("change"),
});

defineExpose({
  getHTML: () => editor.value?.getHTML() ?? "",
  focus: () => editor.value?.commands.focus(),
});

// ── Bubble toolbar (v3 ships the plugin only; we own the element) ──
onMounted(() => {
  if (!editor.value || !bubbleEl.value) return;
  editor.value.registerPlugin(
    BubbleMenuPlugin({
      pluginKey: "bubbleMenu",
      editor: editor.value,
      element: bubbleEl.value,
      shouldShow: ({ editor: e, from, to }) =>
        from !== to && e.isEditable && !e.state.selection.empty,
    }),
  );
});

onBeforeUnmount(() => {
  editor.value?.destroy();
});

// ── HTML inspector (verifies the HTML round-trip) ──
const showHtml = ref(false);
const html = ref("");
function toggleHtml() {
  html.value = editor.value?.getHTML() ?? "";
  showHtml.value = !showHtml.value;
}

function link() {
  const input = window.prompt("Link URL");
  if (input === null) return; // cancelled
  if (input.trim() === "") {
    editor.value?.chain().focus().unsetLink().run();
    return;
  }
  // Validate here too: `setLink` is a direct command and does not run Link's
  // `validate`, so without this an editor could type a `javascript:` href.
  const href = safeLinkUrl(input);
  if (!href) {
    window.alert("That link URL isn't allowed (use http, https, mailto or tel).");
    return;
  }
  editor.value?.chain().focus().setLink({ href }).run();
}
</script>

<template>
  <div class="sheet">
    <EditorContent :editor="editor" class="prose" />

    <!-- Bubble toolbar: positioned by the BubbleMenu plugin -->
    <div ref="bubbleEl" class="bubble">
      <template v-if="editor">
        <button :class="{ on: editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()"><b>B</b></button>
        <button :class="{ on: editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()"><i>i</i></button>
        <button :class="{ on: editor.isActive('link') }" @click="link"> link </button>
        <span class="sep" />
        <button :class="{ on: editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
        <button :class="{ on: editor.isActive('heading', { level: 3 }) }" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()">H3</button>
        <button :class="{ on: editor.isActive('blockquote') }" @click="editor.chain().focus().toggleBlockquote().run()">❝</button>
      </template>
    </div>

    <SlashMenu
      v-if="slashOpen"
      :items="slashItems"
      :selected="slashSelected"
      :top="slashTop"
      :left="slashLeft"
      @select="runSlash"
      @hover="(i) => (slashSelected = i)"
    />

    <button class="html-toggle" @click="toggleHtml">&lt;/&gt;</button>
    <pre v-if="showHtml" class="html-panel">{{ html }}</pre>
  </div>
</template>

<style scoped>
.sheet {
  width: 100%;
  max-width: 44rem;
}

.prose :deep(.tiptap) {
  outline: none;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.25rem;
  line-height: 1.75;
  color: #2a2a2a;
}
.prose :deep(.tiptap > * + *) {
  margin-top: 1.1em;
}
.prose :deep(h2) {
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-top: 1.8em;
}
.prose :deep(h3) {
  font-size: 1.35rem;
  font-weight: 700;
  margin-top: 1.5em;
}
.prose :deep(blockquote) {
  border-left: 3px solid #1a1a1a;
  margin-left: 0;
  padding-left: 1.1rem;
  font-style: italic;
  color: #555;
}
.prose :deep(hr) {
  border: none;
  border-top: 1px solid #e2e2e2;
  margin: 2em 0;
}
/* Lists + code — re-asserted because Tailwind's preflight strips list markers
   and inline-code styling that the writing canvas relies on. */
.prose :deep(ul),
.prose :deep(ol) {
  padding-left: 1.4em;
}
.prose :deep(ul) {
  list-style: disc;
}
.prose :deep(ol) {
  list-style: decimal;
}
.prose :deep(li) {
  margin-top: 0.3em;
}
.prose :deep(li > p) {
  margin: 0;
}
.prose :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
  background: #f4f4f5;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.prose :deep(pre) {
  background: #18181b;
  color: #e4e4e7;
  padding: 1rem 1.1rem;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 0.92rem;
  line-height: 1.6;
}
.prose :deep(pre code) {
  background: none;
  padding: 0;
  font-size: inherit;
}
.prose :deep(a) {
  color: #1a1a1a;
  text-decoration: underline;
  text-underline-offset: 2px;
}
/* Placeholder for empty nodes */
.prose :deep(p.is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: #c4c4c4;
  pointer-events: none;
}

/* Bubble toolbar — starts out-of-flow + hidden; the plugin reveals/positions
   it on text selection (it only runs its hide path after the first update). */
.bubble {
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.2rem;
  background: #1a1a1a;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}
.bubble button {
  min-width: 1.9rem;
  height: 1.9rem;
  padding: 0 0.45rem;
  border: none;
  background: none;
  color: #fff;
  font-size: 0.85rem;
  border-radius: 5px;
  cursor: pointer;
}
.bubble button:hover {
  background: rgba(255, 255, 255, 0.15);
}
.bubble button.on {
  background: rgba(255, 255, 255, 0.28);
}
.bubble .sep {
  width: 1px;
  height: 1.2rem;
  margin: 0 0.2rem;
  background: rgba(255, 255, 255, 0.25);
}

/* HTML inspector */
.html-toggle {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 40;
  padding: 0.4rem 0.6rem;
  border: 1px solid #e2e2e2;
  border-radius: 6px;
  background: #fff;
  color: #666;
  font-family: ui-monospace, monospace;
  cursor: pointer;
}
.html-panel {
  position: fixed;
  right: 1rem;
  bottom: 3.4rem;
  z-index: 40;
  width: min(38rem, 92vw);
  max-height: 60vh;
  overflow: auto;
  margin: 0;
  padding: 1rem;
  background: #1a1a1a;
  color: #d8d8d8;
  border-radius: 8px;
  font-size: 0.78rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
