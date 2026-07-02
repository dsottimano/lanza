import { Node, mergeAttributes } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import FigureView from "../nodeviews/FigureView.vue";
import { safeImageUrl } from "../url";

// Image-with-caption card. Caption is editable rich text; the image src is an
// attribute set either by URL or by uploading a file (committed to the repo via
// FigureView). Serializes to semantic <figure><img><figcaption>…</figcaption>.
export const Figure = Node.create({
  name: "figure",
  group: "block",
  content: "inline*",
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure",
        contentElement: "figcaption",
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector("img");
          return img ? { src: img.getAttribute("src"), alt: img.getAttribute("alt") || "" } : false;
        },
      },
      // Bare <img> (no <figure> wrapper). The bot's markdown `![alt](src)` renders
      // as `<p><img></p>` via marked; with no Image node registered, ProseMirror
      // would drop the unmatched img and the next save would commit the post
      // without it. Adopt it as a Figure instead (one image concept, empty
      // caption). Skip imgs already inside a <figure> — the rule above owns those.
      {
        tag: "img[src]",
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          if (img.closest("figure")) return false;
          return { src: img.getAttribute("src"), alt: img.getAttribute("alt") || "" };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, alt, ...rest } = HTMLAttributes;
    return [
      "figure",
      mergeAttributes(rest, { class: "figure" }),
      ["img", { src: safeImageUrl(src as string), alt }],
      ["figcaption", {}, 0],
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(FigureView);
  },
});
