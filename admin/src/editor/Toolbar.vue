<script setup lang="ts">
// Persistent glass toolbar above the writing canvas — the Tiptap "Simple Editor"
// layout, built natively in Vue to match Lanza's liquid-glass chrome. All marks
// and node commands come from the same extensions the slash menu and keyboard
// shortcuts drive; the "Add" menu reuses the slash catalog's insert commands so
// there's a single source of truth for insertables.
import { onBeforeUnmount, ref, watch } from "vue";
import type { Editor } from "@tiptap/core";
import { SLASH_ITEMS, type SlashItem } from "./extensions/slash";

const props = defineProps<{
  editor: Editor | undefined;
  // Owned by Editor.vue: the validated link prompt (see safeLinkUrl).
  onLink: () => void;
}>();

// TipTap mutates the editor in place, so its `isActive`/`can` results don't
// change object identity. Bump a reactive tick on every transaction and read it
// inside the query helpers so the toolbar's active/disabled states re-evaluate.
const tick = ref(0);
const bump = () => (tick.value += 1);
watch(
  () => props.editor,
  (ed, _prev, onCleanup) => {
    if (!ed) return;
    ed.on("transaction", bump);
    onCleanup(() => ed.off("transaction", bump));
  },
  { immediate: true },
);
onBeforeUnmount(() => props.editor?.off("transaction", bump));

function isActive(name: string, attrs?: Record<string, unknown>): boolean {
  void tick.value;
  return props.editor?.isActive(name, attrs as never) ?? false;
}
function isAlign(value: string): boolean {
  void tick.value;
  return props.editor?.isActive({ textAlign: value }) ?? false;
}
function canUndo(): boolean {
  void tick.value;
  return props.editor?.can().undo() ?? false;
}
function canRedo(): boolean {
  void tick.value;
  return props.editor?.can().redo() ?? false;
}

// ── Commands (thin wrappers so the template stays declarative) ──────────────
const cmd = () => props.editor?.chain().focus();
const setBlock = (level: 2 | 3 | null) => {
  const c = cmd();
  if (!c) return;
  (level ? c.setHeading({ level }) : c.setParagraph()).run();
  openMenu.value = null;
};
const headingLabel = () => {
  void tick.value;
  if (isActive("heading", { level: 2 })) return "Heading 2";
  if (isActive("heading", { level: 3 })) return "Heading 3";
  return "Paragraph";
};

// ── Dropdowns (heading + Add). One open at a time; close on outside click. ──
const openMenu = ref<"heading" | "add" | null>(null);
function toggleMenu(name: "heading" | "add") {
  openMenu.value = openMenu.value === name ? null : name;
}
function onDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest(".tb-menu")) openMenu.value = null;
}
watch(openMenu, (open) => {
  if (open) document.addEventListener("mousedown", onDocClick);
  else document.removeEventListener("mousedown", onDocClick);
});
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));

// ── "Add" menu: reuse the slash catalog's insert commands (no duplication). ──
const ADD_TITLES = [
  "Image",
  "Callout",
  "Embed",
  "2 columns",
  "3 columns",
  "Testimonial",
  "Logo strip",
];
const addItems: SlashItem[] = ADD_TITLES.map(
  (t) => SLASH_ITEMS.find((i) => i.title === t)!,
).filter(Boolean);
function runAdd(item: SlashItem) {
  const ed = props.editor;
  if (!ed) return;
  const { from, to } = ed.state.selection; // empty range → deleteRange is a no-op
  item.command({ editor: ed, range: { from, to } });
  openMenu.value = null;
}

// Inline stroke icons (Tabler-style, 24px). Static markup → v-html is safe here.
const icons: Record<string, string> = {
  undo: '<path d="M9 13l-4 -4l4 -4"/><path d="M5 9h11a4 4 0 0 1 0 8h-1"/>',
  redo: '<path d="M15 13l4 -4l-4 -4"/><path d="M19 9h-11a4 4 0 0 0 0 8h1"/>',
  bullet:
    '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M5 6v.01"/><path d="M5 12v.01"/><path d="M5 18v.01"/>',
  ordered:
    '<path d="M11 6h9"/><path d="M11 12h9"/><path d="M12 18h8"/><path d="M4 16a2 2 0 1 1 4 0c0 .591 -.417 1.318 -1 2l-3 3h4"/><path d="M6 10v-6l-2 2"/>',
  quote:
    '<path d="M10 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5"/><path d="M19 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5"/>',
  codeBlock:
    '<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>',
  link:
    '<path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/>',
  highlight:
    '<path d="M3 19h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M12.5 5.5l4 4"/><path d="M4.5 13.5l4 4"/><path d="M21 21h-8"/>',
  alignLeft: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h14"/>',
  alignCenter: '<path d="M4 6h16"/><path d="M8 12h8"/><path d="M6 18h12"/>',
  alignRight: '<path d="M4 6h16"/><path d="M10 12h10"/><path d="M6 18h14"/>',
  alignJustify: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  chevron: '<path d="M6 9l6 6l6 -6"/>',
};
</script>

<template>
  <div v-if="editor" class="tb" role="toolbar" aria-label="Formatting">
    <!-- History -->
    <div class="tb-group">
      <button class="tb-btn" title="Undo (⌘Z)" :disabled="!canUndo()" @click="cmd()?.undo().run()" v-html="`<svg viewBox='0 0 24 24'>${icons.undo}</svg>`" />
      <button class="tb-btn" title="Redo (⌘⇧Z)" :disabled="!canRedo()" @click="cmd()?.redo().run()" v-html="`<svg viewBox='0 0 24 24'>${icons.redo}</svg>`" />
    </div>
    <span class="tb-sep" />

    <!-- Block type -->
    <div class="tb-menu">
      <button class="tb-btn tb-heading" title="Text style" :class="{ on: openMenu === 'heading' }" @click="toggleMenu('heading')">
        <span>{{ headingLabel() }}</span>
        <svg viewBox="0 0 24 24" class="tb-chevron" v-html="icons.chevron" />
      </button>
      <div v-if="openMenu === 'heading'" class="tb-pop">
        <button class="tb-item" :class="{ on: !isActive('heading') }" @click="setBlock(null)">Paragraph</button>
        <button class="tb-item h2" :class="{ on: isActive('heading', { level: 2 }) }" @click="setBlock(2)">Heading 2</button>
        <button class="tb-item h3" :class="{ on: isActive('heading', { level: 3 }) }" @click="setBlock(3)">Heading 3</button>
      </div>
    </div>
    <span class="tb-sep" />

    <!-- Lists + quote + code block -->
    <div class="tb-group">
      <button class="tb-btn" title="Bullet list" :class="{ on: isActive('bulletList') }" @click="cmd()?.toggleBulletList().run()" v-html="`<svg viewBox='0 0 24 24'>${icons.bullet}</svg>`" />
      <button class="tb-btn" title="Numbered list" :class="{ on: isActive('orderedList') }" @click="cmd()?.toggleOrderedList().run()" v-html="`<svg viewBox='0 0 24 24'>${icons.ordered}</svg>`" />
      <button class="tb-btn" title="Quote" :class="{ on: isActive('blockquote') }" @click="cmd()?.toggleBlockquote().run()" v-html="`<svg viewBox='0 0 24 24'>${icons.quote}</svg>`" />
      <button class="tb-btn" title="Code block" :class="{ on: isActive('codeBlock') }" @click="cmd()?.toggleCodeBlock().run()" v-html="`<svg viewBox='0 0 24 24'>${icons.codeBlock}</svg>`" />
    </div>
    <span class="tb-sep" />

    <!-- Inline marks -->
    <div class="tb-group">
      <button class="tb-btn tb-text" title="Bold (⌘B)" :class="{ on: isActive('bold') }" @click="cmd()?.toggleBold().run()"><b>B</b></button>
      <button class="tb-btn tb-text" title="Italic (⌘I)" :class="{ on: isActive('italic') }" @click="cmd()?.toggleItalic().run()"><i>I</i></button>
      <button class="tb-btn tb-text" title="Underline (⌘U)" :class="{ on: isActive('underline') }" @click="cmd()?.toggleUnderline().run()"><u>U</u></button>
      <button class="tb-btn tb-text" title="Strikethrough" :class="{ on: isActive('strike') }" @click="cmd()?.toggleStrike().run()"><s>S</s></button>
      <button class="tb-btn tb-text" title="Inline code" :class="{ on: isActive('code') }" @click="cmd()?.toggleCode().run()"><code>&lt;/&gt;</code></button>
      <button class="tb-btn" title="Highlight" :class="{ on: isActive('highlight') }" @click="cmd()?.toggleHighlight().run()" v-html="`<svg viewBox='0 0 24 24'>${icons.highlight}</svg>`" />
    </div>
    <span class="tb-sep" />

    <!-- Link + super/subscript -->
    <div class="tb-group">
      <button class="tb-btn" title="Link" :class="{ on: isActive('link') }" @click="onLink" v-html="`<svg viewBox='0 0 24 24'>${icons.link}</svg>`" />
      <button class="tb-btn tb-text" title="Superscript" :class="{ on: isActive('superscript') }" @click="cmd()?.toggleSuperscript().run()">x<sup>2</sup></button>
      <button class="tb-btn tb-text" title="Subscript" :class="{ on: isActive('subscript') }" @click="cmd()?.toggleSubscript().run()">x<sub>2</sub></button>
    </div>
    <span class="tb-sep" />

    <!-- Text align -->
    <div class="tb-group">
      <button class="tb-btn" title="Align left" :class="{ on: isAlign('left') }" @click="cmd()?.setTextAlign('left').run()" v-html="`<svg viewBox='0 0 24 24'>${icons.alignLeft}</svg>`" />
      <button class="tb-btn" title="Align center" :class="{ on: isAlign('center') }" @click="cmd()?.setTextAlign('center').run()" v-html="`<svg viewBox='0 0 24 24'>${icons.alignCenter}</svg>`" />
      <button class="tb-btn" title="Align right" :class="{ on: isAlign('right') }" @click="cmd()?.setTextAlign('right').run()" v-html="`<svg viewBox='0 0 24 24'>${icons.alignRight}</svg>`" />
      <button class="tb-btn" title="Justify" :class="{ on: isAlign('justify') }" @click="cmd()?.setTextAlign('justify').run()" v-html="`<svg viewBox='0 0 24 24'>${icons.alignJustify}</svg>`" />
    </div>
    <span class="tb-sep" />

    <!-- Insert -->
    <div class="tb-menu">
      <button class="tb-btn tb-add" title="Insert" :class="{ on: openMenu === 'add' }" @click="toggleMenu('add')">
        <svg viewBox="0 0 24 24" v-html="icons.plus" />
        <span>Add</span>
      </button>
      <div v-if="openMenu === 'add'" class="tb-pop tb-pop-add">
        <button v-for="item in addItems" :key="item.title" class="tb-item tb-item-add" @click="runAdd(item)">
          <span class="tb-item-ic">{{ item.icon }}</span>
          <span class="tb-item-tt">{{ item.title }}</span>
          <span class="tb-item-hint">{{ item.hint }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tb {
  position: sticky;
  /* Clears the sticky EditorView header (z-30) so the toolbar parks beneath it. */
  top: 3.25rem;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem;
  margin: -0.5rem 0 1.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 14px;
  background: var(--glass-tint-strong);
  backdrop-filter: blur(18px) saturate(180%);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid var(--glass-border-soft);
  box-shadow: var(--glass-shadow-sm), var(--glass-sheen);
}

.tb-group {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}
.tb-sep {
  width: 1px;
  align-self: stretch;
  margin: 0.2rem 0.3rem;
  background: rgba(27, 29, 36, 0.12);
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-width: 1.95rem;
  height: 1.95rem;
  padding: 0 0.4rem;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--ink-soft);
  font-size: 0.9rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.tb-btn :deep(svg) {
  width: 1.15rem;
  height: 1.15rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tb-btn:not(:disabled):hover {
  background: rgba(27, 29, 36, 0.07);
  color: var(--ink);
}
.tb-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.tb-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
/* Active = pressed glass, mirroring .nav-item--active. */
.tb-btn.on,
.tb-btn.on:hover {
  background: rgba(23, 25, 32, 0.9);
  color: #fff;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
}

.tb-text {
  font-family: var(--font-sans);
  font-size: 0.95rem;
}
.tb-text code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
}
.tb-text sup,
.tb-text sub {
  font-size: 0.62em;
}

.tb-heading {
  min-width: 6.5rem;
  padding: 0 0.55rem;
  justify-content: space-between;
  font-size: 0.85rem;
}
.tb-heading .tb-chevron {
  width: 0.9rem;
  height: 0.9rem;
  opacity: 0.6;
}
.tb-add {
  padding: 0 0.6rem;
  font-size: 0.85rem;
  font-weight: 500;
}

/* ── Popovers (heading + Add) ─────────────────────────────────────────────── */
.tb-menu {
  position: relative;
}
.tb-pop {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  z-index: 40;
  min-width: 11rem;
  padding: 0.3rem;
  border-radius: 12px;
  background: var(--glass-tint-strong);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow), var(--glass-sheen);
}
.tb-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0.4rem 0.55rem;
  border: none;
  border-radius: 8px;
  background: none;
  text-align: left;
  color: var(--ink-soft);
  font-size: 0.9rem;
  cursor: pointer;
}
.tb-item:hover {
  background: rgba(27, 29, 36, 0.07);
  color: var(--ink);
}
.tb-item.on {
  color: var(--ink);
  font-weight: 600;
}
.tb-item.h2 {
  font-size: 1.15rem;
  font-weight: 700;
}
.tb-item.h3 {
  font-size: 1rem;
  font-weight: 700;
}

.tb-pop-add {
  min-width: 14rem;
}
.tb-item-add {
  gap: 0.6rem;
}
.tb-item-ic {
  flex: 0 0 1.4rem;
  text-align: center;
  font-size: 1rem;
}
.tb-item-tt {
  font-weight: 500;
  color: var(--ink);
}
.tb-item-hint {
  margin-left: auto;
  padding-left: 0.75rem;
  font-size: 0.75rem;
  color: var(--muted);
}

@media (prefers-reduced-motion: reduce) {
  .tb-btn {
    transition: none;
  }
}
</style>
