import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

export interface SlashItem {
  title: string;
  icon: string;
  hint: string;
  keywords: string[];
  command: (ctx: { editor: Editor; range: Range }) => void;
}

// The `/` command catalog. Each runs after deleting the typed `/query`.
export const SLASH_ITEMS: SlashItem[] = [
  {
    title: "Heading 2",
    icon: "H2",
    hint: "Section heading",
    keywords: ["h2", "heading", "title"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    icon: "H3",
    hint: "Subsection heading",
    keywords: ["h3", "heading", "subtitle"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bulleted list",
    icon: "•",
    hint: "Unordered list",
    keywords: ["bullet", "list", "ul"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    icon: "1.",
    hint: "Ordered list",
    keywords: ["number", "ordered", "list", "ol"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Quote",
    icon: "❝",
    hint: "Blockquote",
    keywords: ["quote", "blockquote", "cite"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Divider",
    icon: "—",
    hint: "Horizontal rule",
    keywords: ["divider", "rule", "hr", "separator"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: "Callout",
    icon: "💡",
    hint: "Highlighted panel",
    keywords: ["callout", "note", "info", "panel"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "callout" }).run(),
  },
  {
    title: "Image",
    icon: "🖼️",
    hint: "Image with caption",
    keywords: ["image", "photo", "picture", "figure"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "figure" }).run(),
  },
  {
    title: "Embed",
    icon: "🔗",
    hint: "Video / iframe by URL",
    keywords: ["embed", "video", "youtube", "iframe"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "embed" }).run(),
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.includes(q)),
  );
}

// Wires the `/` suggestion. `items` + `render` are supplied by Editor.vue so the
// dropdown can be a reactive Vue component.
export const SlashCommand = Extension.create<{
  suggestion: Partial<SuggestionOptions>;
}>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        command: ({ editor, range, props }) => {
          (props as SlashItem).command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
