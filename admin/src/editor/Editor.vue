<script setup lang="ts">
import { onMounted, provide, ref, shallowRef } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import type { GitHubClient } from "../backend/github";
import { CLIENT_KEY } from "../fields/context";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import Toolbar from "./Toolbar.vue";
import { Callout } from "./extensions/Callout";
import { Figure } from "./extensions/Figure";
import { Embed } from "./extensions/Embed";
import { Columns, Column } from "./extensions/Columns";
import { Testimonial } from "./extensions/Testimonial";
import { LogoStrip } from "./extensions/LogoStrip";
import { SlashCommand, filterSlashItems, type SlashItem } from "./extensions/slash";
import { loadBlocks, blockSlashItems } from "../backend/blocks";
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

// ── Slash menu reactive state (driven by the suggestion render callbacks) ──
const slashOpen = ref(false);
const slashItems = ref<SlashItem[]>([]);
const slashSelected = ref(0);
const slashTop = ref(0);
const slashLeft = ref(0);
const slashCommand = shallowRef<((item: SlashItem) => void) | null>(null);
// The user's saved "My blocks", loaded once per mount and appended to the slash
// catalog. Empty until (and unless) the async load resolves — never blocks boot.
const myBlocks = ref<SlashItem[]>([]);

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
    Highlight,
    // Only text blocks carry alignment; it writes `style="text-align: …"`, which
    // survives the frontend sanitizer unchanged (verified round-trip).
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Superscript,
    Subscript,
    Callout,
    Figure,
    Embed,
    Columns,
    Column,
    Testimonial,
    LogoStrip,
    SlashCommand.configure({
      suggestion: {
        items: ({ query }) => filterSlashItems(query, myBlocks.value),
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

onMounted(() => {
  // Load the user's saved "My blocks" into the slash catalog. Async and
  // failure-tolerant: a missing/broken blocks.json just leaves the group empty.
  if (props.client) {
    loadBlocks(props.client)
      .then(({ blocks }) => (myBlocks.value = blockSlashItems(blocks)))
      .catch(() => {});
  }
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
    <Toolbar :editor="editor" :on-link="link" />
    <EditorContent :editor="editor" class="prose" />

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
  max-width: 100%;
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
/* Plain prose keeps a readable line length; structural blocks (columns,
   figures, embeds, testimonials, logo strips) span the full, wider paper. */
.prose :deep(.tiptap > p),
.prose :deep(.tiptap > h2),
.prose :deep(.tiptap > h3),
.prose :deep(.tiptap > ul),
.prose :deep(.tiptap > ol),
.prose :deep(.tiptap > blockquote),
.prose :deep(.tiptap > pre),
.prose :deep(.tiptap > hr),
.prose :deep(.tiptap > .callout) {
  max-width: 46rem;
  margin-inline: auto;
}

/* Columns — mirror the published grid so editing looks like the result; the
   dashed cell borders are an editing affordance only (not in the output HTML). */
.prose :deep(.cols) {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 1.4em 0;
}
.prose :deep(.cols[data-cols="3"]) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.prose :deep(.col) {
  min-width: 0;
  padding: 0.85rem 1rem;
  border: 1px dashed #e2e2e2;
  border-radius: 8px;
}
.prose :deep(.col > * + *) {
  margin-top: 0.8em;
}
@media (max-width: 640px) {
  .prose :deep(.cols),
  .prose :deep(.cols[data-cols="3"]) {
    grid-template-columns: minmax(0, 1fr);
  }
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
/* Highlight — soft amber wash that reads on the light paper; mirrors the
   .post-body mark token so editing matches the published result. */
.prose :deep(mark) {
  background: #fdeaa8;
  color: inherit;
  padding: 0.05em 0.15em;
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
/* Placeholder for empty nodes */
.prose :deep(p.is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: #c4c4c4;
  pointer-events: none;
}

/* HTML inspector */
.html-toggle {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 40;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--glass-border);
  border-radius: 11px;
  background: var(--glass-tint-strong);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  color: var(--ink-soft);
  box-shadow: var(--glass-shadow-sm);
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
