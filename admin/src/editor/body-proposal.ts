import { createNodeFromContent, getHTMLFromFragment, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { safeEmbedUrl, safeImageUrl, safeLinkUrl } from "./url";

export const MAX_BODY_HTML = 100_000;
export type BodyTarget = "body" | "selection";

// Parse inert markup first, reject active content, then serialize only nodes and
// attributes declared by the CURRENT editor's schema. No caller HTML reaches a
// mounted preview or live document before this validation.
function parseProposal(editor: Editor, html: string): Fragment {
  if (html.length > MAX_BODY_HTML) throw new Error(`Body proposals are limited to ${MAX_BODY_HTML} characters.`);
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll("*")) {
    if (/^(SCRIPT|STYLE|OBJECT|EMBED|FORM|INPUT|BUTTON|SVG|MATH|LINK|META|BASE|TEMPLATE)$/.test(element.tagName.toUpperCase())) {
      throw new Error("Body proposals cannot contain active HTML.");
    }
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction" ||
          (name === "style" && /url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i.test(attribute.value))) {
        throw new Error("Body proposals cannot contain active HTML attributes.");
      }
      if (name === "href" && !safeLinkUrl(attribute.value)) throw new Error("Body proposal contains an unsafe link.");
      if (name === "src" && !safeImageUrl(attribute.value)) throw new Error("Body proposal contains an unsafe image or embed URL.");
      if (name === "data-src" && !safeImageUrl(attribute.value)) throw new Error("Body proposal contains an unsafe URL.");
    }
    if (element.tagName === "IFRAME" && (!element.parentElement?.matches("div[data-embed]") ||
        !safeEmbedUrl(element.getAttribute("src")))) throw new Error("Use an editor embed card for a safe iframe.");
  }
  let parsed: ProseMirrorNode;
  try {
    parsed = createNodeFromContent(html, editor.schema, { slice: false, errorOnInvalidContent: true }) as ProseMirrorNode;
    parsed.check();
  } catch {
    throw new Error("This body proposal contains formatting the current editor cannot preserve. Use supported editor HTML.");
  }
  return parsed.content;
}

/** Review previews use a smaller, inert prose vocabulary. No external resources,
 * links, event attributes or author CSS. Full editor HTML remains in the diff. */
export function readableBodyHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowed = new Set("P H1 H2 H3 H4 H5 H6 STRONG B EM I S U MARK CODE PRE BLOCKQUOTE UL OL LI BR HR TABLE TBODY THEAD TFOOT TR TH TD FIGURE FIGCAPTION DIV SPAN A SUB SUP".split(" "));
  for (const element of [...template.content.querySelectorAll("*")]) {
    if (!allowed.has(element.tagName.toUpperCase())) {
      element.replaceWith(document.createTextNode(element.tagName.toUpperCase() === "IMG"
        ? `[Image: ${element.getAttribute("alt") ?? ""}]` : element.tagName.toUpperCase() === "IFRAME" ? "[Embed]" : element.textContent ?? ""));
      continue;
    }
    if (element.matches("a[href]")) {
      element.appendChild(document.createTextNode(` [link: ${element.getAttribute("href")}]`));
    }
    for (const attribute of [...element.attributes]) {
      if (!(element.matches("td,th") && /^(colspan|rowspan)$/.test(attribute.name) && /^[1-9][0-9]{0,2}$/.test(attribute.value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return template.innerHTML;
}

export function bodyContext(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  const html = editor.getHTML();
  if (html.length > MAX_BODY_HTML) throw new Error("This body is too large for live site tools.");
  return {
    html,
    selection: empty || !(editor.state.selection instanceof TextSelection) ? null : { from, to,
      text: editor.state.doc.textBetween(from, to, "\n"),
      html: getHTMLFromFragment(editor.state.doc.slice(from, to).content, editor.schema),
    },
  };
}

/** Prepare an immutable, fully validated editor transaction WITHOUT applying it.
 * The caller must recheck revision/access AND the captured selection/document
 * after human review. A single transaction keeps normal undo available. */
export function prepareBodyProposal(editor: Editor, target: BodyTarget, html: string) {
  const before = bodyContext(editor);
  if (target === "selection" && !before.selection) throw new Error("Select text in the body before proposing a selection replacement.");
  const fragment = parseProposal(editor, html);
  const currentDoc = editor.state.doc;
  const from = target === "body" ? 0 : before.selection!.from;
  const to = target === "body" ? currentDoc.content.size : before.selection!.to;
  const transaction = target === "body"
    ? editor.state.tr.replaceWith(from, to, fragment)
    : editor.state.tr.replaceRange(from, to, Slice.maxOpen(fragment, false));
  transaction.doc.check();
  const after = getHTMLFromFragment(transaction.doc.content, editor.schema);
  if (after.length > MAX_BODY_HTML) throw new Error("The proposed body would exceed the live tool size limit.");
  return { before: before.html, after, selection: before.selection,
    changed: !transaction.doc.eq(currentDoc),
    apply: () => {
      if (editor.isDestroyed || editor.state.doc !== currentDoc ||
          (target === "selection" && (editor.state.selection.from !== from || editor.state.selection.to !== to))) {
        throw new Error("The body or selection changed during review. Nothing was applied; read fresh context.");
      }
      editor.view.dispatch(transaction.scrollIntoView());
    },
  };
}
