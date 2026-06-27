import { Node, mergeAttributes } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import CalloutView from "../nodeviews/CalloutView.vue";

// Ghost-style callout card: an emoji + a single rich-text body, on a tinted
// panel. Serializes to <div data-callout data-emoji="…" class="callout">…</div>
// so the public site can style it from static HTML (Phase 5).
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (el) => el.getAttribute("data-emoji") || "💡",
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-callout": "", class: "callout" }),
      0,
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(CalloutView);
  },
});
