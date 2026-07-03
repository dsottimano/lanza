import { Node, mergeAttributes } from "@tiptap/core";

// Multi-column layout: a `columns` container holding 2 or 3 `column` children,
// each a normal block-content region. No Vue nodeview — ProseMirror edits the
// column divs directly, so click/arrow navigation between them just works. The
// editing surface is styled in Editor.vue so it looks like the published result.
//
// Serializes to <div class="cols" data-cols="n"><div class="col">…</div>…</div>,
// which survives the public-site sanitizer unchanged (plain div + class + data-*).

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: "div.col" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "col" }), 0];
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  isolating: true,

  addAttributes() {
    return {
      cols: {
        default: 2,
        // Clamp to the 2–3 the schema allows so a hand-edited data-cols can't
        // set an out-of-range grid track count.
        parseHTML: (el) => (el.getAttribute("data-cols") === "3" ? 3 : 2),
        renderHTML: (attrs) => ({ "data-cols": String(attrs.cols) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div.cols" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "cols" }), 0];
  },
});
