import { Node, mergeAttributes } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import TestimonialView from "../nodeviews/TestimonialView.vue";
import { safeImageUrl } from "../url";

// Customer testimonial: a rich-text quote (the editable content) plus author,
// role and an optional avatar image (set by URL or upload, like FigureView).
// Serializes to
//   <figure class="testimonial" data-testimonial>
//     <blockquote>…quote…</blockquote>
//     <figcaption><img class="avatar" …><span class="who">…</span><span class="role">…</span></figcaption>
//   </figure>
// which survives the public sanitizer unchanged (figure/blockquote/figcaption/
// img/span with class + data-* + validated src are all DOMPurify defaults).
//
// priority sits above Figure so a <figure data-testimonial> is claimed here and
// not by Figure's generic `figure` rule (which would match on the avatar img).
export const Testimonial = Node.create({
  name: "testimonial",
  group: "block",
  content: "inline*",
  draggable: true,
  isolating: true,
  priority: 200,

  addAttributes() {
    // author/role/avatar live in child elements, not on the <figure>, so each
    // parses from the DOM and renders nothing onto the wrapper (renderHTML in
    // the node body emits the children by hand).
    return {
      author: {
        default: "",
        parseHTML: (el) => el.querySelector(".who")?.textContent?.trim() || "",
        renderHTML: () => ({}),
      },
      role: {
        default: "",
        parseHTML: (el) => el.querySelector(".role")?.textContent?.trim() || "",
        renderHTML: () => ({}),
      },
      // Raw URL kept in the node so the nodeview can edit it; only the
      // safeImageUrl-validated value reaches committed HTML (see renderHTML).
      avatar: {
        default: "",
        parseHTML: (el) => el.querySelector("img.avatar")?.getAttribute("src") || "",
        renderHTML: () => ({}),
      },
      avatarAlt: {
        default: "",
        parseHTML: (el) => el.querySelector("img.avatar")?.getAttribute("alt") || "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-testimonial]", contentElement: "blockquote" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const src = safeImageUrl(node.attrs.avatar as string);
    const figcaption: (string | Record<string, string> | (string | Record<string, string>)[])[] = [
      "figcaption",
      {},
    ];
    if (src) figcaption.push(["img", { class: "avatar", src, alt: (node.attrs.avatarAlt as string) || "" }]);
    figcaption.push(["span", { class: "who" }, (node.attrs.author as string) || ""]);
    figcaption.push(["span", { class: "role" }, (node.attrs.role as string) || ""]);
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { class: "testimonial", "data-testimonial": "" }),
      ["blockquote", {}, 0],
      figcaption,
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(TestimonialView);
  },
});
