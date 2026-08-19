// What a browser would ACT ON in a fragment of HTML, found with a real HTML parser.
//
// This walk was written for frontend/lib/assert-rendered-safe.ts and lived there. It
// moved here because it has a second caller now — the site-system checker, which uses
// it to decide whether an AGENT-written template is safe to accept. One walk, two
// callers, because the lesson that produced this file in the first place was that
// hand-rolled HTML pattern matching loses:
//
//   > Five independent review rounds each found a case where [the engine's] answer
//   > disagreed with a real HTML parser — alt="a>b", alt="a<b>c", a long attribute
//   > scrolling the tag out of view, an apostrophe inside a comment, <!-- --!>,
//   > <<a href=, SVG <title>, a {{#if}} that opens a tag. Each was fixed. The pattern
//   > is the finding: the WHATWG tokenizer has ~80 states and that engine has 7, so
//   > "we fixed the last one" is not evidence there is no next one.
//
// So: never grep for `<script`. Parse, walk, and classify what is actually there.
//
// The two callers want DIFFERENT answers from the same walk, which is why every
// finding carries a `kind` and the policy lives in the caller:
//
//   * assert-rendered-safe.ts diffs two renders and reports only what a VALUE
//     introduced. Author markup appears in both and is ignored, so it can afford to
//     flag broadly — a template's own <style> is never a finding there.
//   * the site-system checker (functions/_lib/site-system.mjs) has no control render:
//     when an agent wrote the template, the author is not trusted either. It reads the
//     findings ABSOLUTELY, and therefore must NOT treat a <style> block or a
//     background-image url() as a problem — those are what templates are made of.
//
// `key` is a stable string for set-diffing and is byte-identical to what this walk
// emitted before the split; assert-rendered-safe.ts's behaviour depends on that.
//
// parse5 is a direct, exact-pinned dependency of this package (see the note in
// assert-rendered-safe.ts about why it must not be a transitive one). It is pure JS
// and bundles into the Cloudflare Functions build — verified with
// `npx wrangler@3.114.17 pages functions build`, the check CLAUDE.md prescribes.
import { parseFragment } from "parse5";

// Schemes a URL attribute may carry. Mirrors frontend/lib/url.ts — kept separate on
// purpose: this is an independent check, and sharing the predicate would let one bug
// hide both.
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/(?![/\\]))/i;

// Elements that fetch code, embed a document, or send data somewhere.
const LOADS_OR_SENDS = new Set(["script", "iframe", "object", "embed", "form", "link", "use", "frame"]);

export const URL_ATTRS = new Set([
  "href",
  "xlink:href",
  "src",
  "srcset",
  "action",
  "formaction",
  "poster",
  "cite",
  "background",
  "ping",
  "data",
  "longdesc",
]);

/**
 * One thing a browser would act on.
 *
 * `kind` is what it is; `tag` is set on element findings so a caller can apply policy
 * per element without re-parsing the key.
 *
 * @typedef {{ key: string, kind: string, detail: string, tag?: string }} Danger
 */

/**
 * @typedef {{ nodeName: string, attrs?: Array<{name: string, value: string}>,
 *             childNodes?: Node[], content?: Node, value?: string }} Node
 */

/**
 * Everything in this HTML that a browser would treat as dangerous.
 *
 * @param {string} html
 * @returns {Danger[]}
 */
export function dangerousConstructs(html) {
  /** @type {Danger[]} */
  const found = [];
  /** @param {Node} n */
  const walk = (n) => {
    for (const a of n.attrs ?? []) {
      const name = a.name.toLowerCase();
      // A URL parser strips these anywhere in a URL, so strip before judging.
      const v = (a.value ?? "").replace(/[\t\n\r]/g, "").trim();
      if (!v) continue;
      if (name.startsWith("on")) {
        found.push({ key: `handler:${name}=${v}`, kind: "handler", detail: `${name}="${v}"`, tag: n.nodeName });
      } else if (name === "srcdoc") {
        found.push({ key: `srcdoc=${v}`, kind: "srcdoc", detail: `srcdoc="${v}"`, tag: n.nodeName });
      } else if (name === "style" && /url\(|expression|@import/i.test(v)) {
        found.push({ key: `style=${v}`, kind: "inline-style-url", detail: `style="${v}"`, tag: n.nodeName });
      } else if (n.nodeName === "base" && name === "href") {
        found.push({ key: `base=${v}`, kind: "base", detail: `<base href="${v}">`, tag: n.nodeName });
      } else if (n.nodeName === "meta" && name === "content" && /url\s*=/i.test(v)) {
        found.push({ key: `refresh=${v}`, kind: "meta-refresh", detail: `<meta content="${v}">`, tag: n.nodeName });
      } else if (URL_ATTRS.has(name) && !SAFE_URL.test(v)) {
        // Two different problems wear the same failed test, and conflating them was
        // telling an agent that `<a href="about">` "runs JavaScript on this origin".
        // A value carrying a SCHEME (or a protocol-relative `//host`) can reach code
        // or another origin; a bare relative path cannot do either — it is merely a
        // dead link, because a page at /services/x/ resolves it to /services/x/about.
        // `key` is unchanged on purpose: assert-rendered-safe.ts set-diffs on it.
        const reaches = /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("//") || v.startsWith("\\\\");
        found.push({
          key: `url:${name}=${v}`,
          kind: reaches ? "url-scheme" : "url-relative",
          detail: `${name}="${v}"`,
          tag: n.nodeName,
        });
      }
    }
    if (n.nodeName === "script" || n.nodeName === "style") {
      const text = n.childNodes?.[0]?.value ?? "";
      if (text.trim()) {
        found.push({
          key: `${n.nodeName}-text:${text}`,
          kind: `${n.nodeName}-text`,
          detail: `<${n.nodeName}> containing ${text.trim().length} characters`,
          tag: n.nodeName,
        });
      }
    }
    // The ELEMENT itself, not just its attribute value. A URL allowlist cannot catch
    // `<script src="https://evil.example/x.js">` — https is a perfectly good scheme;
    // the problem is that a script element exists at all.
    if (LOADS_OR_SENDS.has(n.nodeName)) {
      const attrs = (n.attrs ?? [])
        .filter((a) => ["src", "href", "data", "action", "srcdoc"].includes(a.name.toLowerCase()))
        .map((a) => `${a.name.toLowerCase()}=${a.value}`)
        .join("|");
      found.push({
        key: `element:${n.nodeName}[${attrs}]`,
        kind: "element",
        detail: `<${n.nodeName}${attrs ? ` ${attrs}` : ""}>`,
        tag: n.nodeName,
      });
    }
    for (const c of n.childNodes ?? []) walk(c);
    // parse5 hangs a <template>'s children off `content`, NOT childNodes, so a walk
    // that only follows childNodes sees an EMPTY <template> and reports nothing —
    // `<template><script>…</script></template>` came back clean. The content is inert
    // until something clones it, so this is not a live hole today; it is flagged
    // because "a real parser has structure a hand-rolled walk forgets" is the exact
    // failure this file exists to stop, and forgetting one is the same bug.
    if (n.content) walk(/** @type {Node} */ (n.content));
  };
  walk(/** @type {Node} */ (/** @type {unknown} */ (parseFragment(html))));
  return found;
}
