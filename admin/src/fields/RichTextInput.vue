<script setup lang="ts">
// Basic rich text for a template's `richtext` field: bold, italic, underline, and the
// fixed size and theme-font classes from functions/_lib/rich-text.mjs. The editor's
// schema allows nothing else, so stored HTML outside that set is dropped on load; the
// build sanitizes again (frontend/lib/sanitize.ts) because files can be edited directly.
import { onBeforeUnmount, watch } from "vue";
import { Mark } from "@tiptap/core";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { RICH_TEXT_CSS, RICH_TEXT_FONTS, RICH_TEXT_SIZES, richTextClass } from "../../../functions/_lib/rich-text.mjs";

// The same size/font rules the public site emits, so the editor shows what publishes.
if (typeof document !== "undefined" && !document.getElementById("lz-rich-text-css")) {
  const style = document.createElement("style");
  style.id = "lz-rich-text-css"; style.textContent = RICH_TEXT_CSS;
  document.head.append(style);
}

const props = defineProps<{ inputId?: string; labelledBy?: string }>();
const model = defineModel<string>();

// One mark per class family. A span may carry both families, so neither rule consumes it.
function classMark(name: string, kind: "size" | "font", values: string[]) {
  const valueOf = (el: HTMLElement) => values.find(v => el.classList.contains(richTextClass(kind, v))) ?? null;
  return Mark.create({
    name,
    addAttributes() { return { value: { default: null, parseHTML: el => valueOf(el), renderHTML: () => ({}) } }; },
    parseHTML() { return [{ tag: "span", consuming: false, getAttrs: el => (valueOf(el as HTMLElement) ? null : false) }]; },
    renderHTML({ mark }) { return ["span", { class: richTextClass(kind, String(mark.attrs.value)) }, 0]; },
  });
}
const TextSize = classMark("textSize", "size", RICH_TEXT_SIZES.map(s => s.value));
const TextFont = classMark("textFont", "font", RICH_TEXT_FONTS.map(f => f.value));

const html = () => (editor.value?.isEmpty ? "" : editor.value?.getHTML() ?? "");
const editor = useEditor({
  content: model.value ?? "",
  extensions: [
    StarterKit.configure({
      heading: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, blockquote: false,
      codeBlock: false, code: false, horizontalRule: false, strike: false, link: false,
    }),
    TextSize, TextFont,
  ],
  editorProps: { attributes: { ...(props.inputId ? { id: props.inputId } : {}), ...(props.labelledBy ? { "aria-labelledby": props.labelledBy } : {}),
    role: "textbox", "aria-multiline": "true", class: "rich-text-input__doc" } },
  onUpdate: () => { model.value = html(); },
});
// An external change (a revert in Changes, an agent proposal) replaces the content.
watch(model, value => { if (editor.value && (value ?? "") !== html()) editor.value.commands.setContent(value ?? "", { emitUpdate: false }); });
onBeforeUnmount(() => editor.value?.destroy());

function setClass(name: "textSize" | "textFont", value: string) {
  const chain = editor.value?.chain().focus();
  (value ? chain?.setMark(name, { value }) : chain?.unsetMark(name))?.run();
}
const current = (name: "textSize" | "textFont") => String(editor.value?.getAttributes(name).value ?? "");
defineExpose({ editor });
</script>

<template>
  <div class="rich-text-input input">
    <div class="rich-text-input__bar" role="toolbar" aria-label="Formatting">
      <button type="button" aria-label="Bold" :aria-pressed="!!editor?.isActive('bold')" @click="editor?.chain().focus().toggleBold().run()"><strong>B</strong></button>
      <button type="button" aria-label="Italic" :aria-pressed="!!editor?.isActive('italic')" @click="editor?.chain().focus().toggleItalic().run()"><em>I</em></button>
      <button type="button" aria-label="Underline" :aria-pressed="!!editor?.isActive('underline')" @click="editor?.chain().focus().toggleUnderline().run()"><u>U</u></button>
      <select aria-label="Text size" :value="current('textSize')" @change="setClass('textSize', ($event.target as HTMLSelectElement).value)">
        <option value="">Normal size</option>
        <option v-for="s in RICH_TEXT_SIZES" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <select aria-label="Font" :value="current('textFont')" @change="setClass('textFont', ($event.target as HTMLSelectElement).value)">
        <option value="">Default font</option>
        <option v-for="f in RICH_TEXT_FONTS" :key="f.value" :value="f.value">{{ f.label }}</option>
      </select>
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>

<style scoped>
.rich-text-input { padding: 0; }
.rich-text-input__bar { display: flex; flex-wrap: wrap; gap: .25rem; padding: .35rem; border-bottom: 1px solid var(--border); }
.rich-text-input__bar button { min-width: 2rem; padding: .2rem .4rem; border-radius: 4px; }
.rich-text-input__bar button[aria-pressed="true"] { background: var(--selection, #e8e6df); }
.rich-text-input__bar select { font-size: .8rem; padding: .15rem .3rem; }
.rich-text-input :deep(.rich-text-input__doc) { min-height: 6rem; padding: .6rem .75rem; outline: none; }
.rich-text-input :deep(.rich-text-input__doc p) { margin: 0 0 .6em; }
</style>
