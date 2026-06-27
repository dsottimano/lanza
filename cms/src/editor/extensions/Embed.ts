import { Node, mergeAttributes } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import EmbedView from "../nodeviews/EmbedView.vue";

// Generic embed card: stores a URL, renders it in an iframe. An empty embed
// shows a URL input in the editor. Serializes to
// <div data-embed data-src="…" class="embed"><iframe …></div>.
export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-src") || "",
        renderHTML: (attrs) => ({ "data-src": attrs.src }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const src = (node.attrs.src as string) || "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-embed": "", class: "embed" }),
      src
        ? [
            "iframe",
            {
              src,
              loading: "lazy",
              allowfullscreen: "true",
              frameborder: "0",
            },
          ]
        : ["span", {}, ""],
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(EmbedView);
  },
});
