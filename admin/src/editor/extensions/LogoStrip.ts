import { Node, mergeAttributes } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import LogoStripView from "../nodeviews/LogoStripView.vue";
import { safeImageUrl } from "../url";

export interface Logo {
  src: string;
  alt: string;
}

// Row of small logos ("as seen in" / client wall). Atom node — its logos live in
// a single `logos` attribute (array of {src, alt}); the nodeview adds/removes
// them by URL or upload. Serializes to
//   <div class="logo-strip" data-logos><img class="logo" …>×n</div>
// Being an atom, ProseMirror consumes the whole div on parse (its child imgs are
// read by getAttrs, never re-parsed as Figures). Plain div + img + class/data-*/
// validated src all survive the public sanitizer unchanged.
export const LogoStrip = Node.create({
  name: "logoStrip",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      logos: {
        default: [] as Logo[],
        // Rendered by hand in renderHTML — nothing goes on the wrapper here.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-logos]",
        getAttrs: (el) => ({
          logos: Array.from((el as HTMLElement).querySelectorAll("img")).map((img) => ({
            src: img.getAttribute("src") || "",
            alt: img.getAttribute("alt") || "",
          })),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const logos = (node.attrs.logos as Logo[]) || [];
    const imgs = logos
      .map((l) => ({ src: safeImageUrl(l.src), alt: l.alt || "" }))
      .filter((l) => l.src)
      .map((l) => ["img", { class: "logo", src: l.src, alt: l.alt }]);
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "logo-strip", "data-logos": "" }),
      ...imgs,
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(LogoStripView);
  },
});
