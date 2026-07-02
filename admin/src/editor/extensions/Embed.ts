import { Node, mergeAttributes } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import EmbedView from "../nodeviews/EmbedView.vue";
import { safeEmbedUrl, safeUrlAttribute } from "../url";

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
      // Stores the raw URL in the node, but only the validated URL reaches
      // committed HTML's data-src (see safeUrlAttribute).
      src: safeUrlAttribute("src", "data-src", safeEmbedUrl),
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const src = safeEmbedUrl(node.attrs.src as string);
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
              // Match the sandbox the public site forces at publish time
              // (frontend/lib/sanitize.ts) so the live editor can't top-navigate
              // the authenticated /admin origin to a phishing page.
              sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups",
            },
          ]
        : ["span", {}, ""],
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(EmbedView);
  },
});
