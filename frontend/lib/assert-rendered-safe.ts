// Build-time backstop for the template engine.
//
// WHY THIS EXISTS, stated plainly: `template-render.ts` decides what "safe" means for a
// value by working out WHERE in the markup that value lands. Five independent review
// rounds each found a case where its answer disagreed with a real HTML parser —
// `alt="a>b"`, `alt="a<b>c"`, a long attribute scrolling the tag out of view, an
// apostrophe inside a comment, `<!-- --!>`, `<<a href=`, SVG `<title>`, a `{{#if}}` that
// opens a tag, an attribute name supplied by data. Each was fixed. The pattern is the
// finding: the WHATWG tokenizer has ~80 states and that engine has 7, so "we fixed the
// last one" is not evidence there is no next one.
//
// This module does not try to make the engine correct. It checks the OUTPUT with the
// same tokenizer a browser uses, and fails the build if a rendered value produced
// something dangerous. That covers misclassifications nobody has thought of yet, which
// is the entire point — it is the only control here that does not depend on the engine
// being right.
//
// It runs at BUILD time only (Astro/Node). It is deliberately not called from
// `render()`, because the CMS preview imports that in the browser and parse5 must not
// enter the admin bundle. parse5 is a DIRECT dependency, pinned exact. It used to be
// reached transitively (isomorphic-dompurify → jsdom, astro → hast-util-from-html), but
// this import fails the BUILD if it ever goes missing, and tenants install with no
// lockfile — so the tree that satisfies it must not be someone else's to change.
//
// FALSE POSITIVES ARE THE RISK, not false negatives: this throws, and a throw fails a
// tenant's deploy. So it never flags author markup. It renders the template TWICE — once
// with the real data and once with every placeholder forced to an inert token — and only
// reports what the real render has and the control render does not. A `<button
// onclick="doThing()">` written by the template author appears in both and is ignored;
// an `onclick` that appeared because of a VALUE appears in only one.
import { parseFragment } from "parse5";
import { render } from "./template-render";

// Schemes a URL attribute may carry. Mirrors ./url.ts — kept separate on purpose: this
// is an independent check, and sharing the predicate would let one bug hide both.
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/(?![/\\]))/i;

// Elements that fetch code, embed a document, or send data somewhere. Their mere
// APPEARANCE due to a value is the finding — the URL they carry may be perfectly
// well-formed https.
const LOADS_OR_SENDS = new Set(["script", "iframe", "object", "embed", "form", "link", "use", "frame"]);

const URL_ATTRS = new Set([
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

interface Node {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: Node[];
  value?: string;
}

/**
 * Everything in this HTML that a browser would treat as dangerous, as a set of stable
 * strings. Comparable between two renders of the same template.
 */
function dangerousConstructs(html: string): Set<string> {
  const found = new Set<string>();
  const walk = (n: Node): void => {
    for (const a of n.attrs ?? []) {
      const name = a.name.toLowerCase();
      // A URL parser strips these anywhere in a URL, so strip before judging.
      const v = (a.value ?? "").replace(/[\t\n\r]/g, "").trim();
      if (!v) continue;
      if (name.startsWith("on")) found.add(`handler:${name}=${v}`);
      else if (name === "srcdoc") found.add(`srcdoc=${v}`);
      else if (name === "style" && /url\(|expression|@import/i.test(v)) found.add(`style=${v}`);
      else if (n.nodeName === "base" && name === "href") found.add(`base=${v}`);
      else if (n.nodeName === "meta" && name === "content" && /url\s*=/i.test(v)) found.add(`refresh=${v}`);
      else if (URL_ATTRS.has(name) && !SAFE_URL.test(v)) found.add(`url:${name}=${v}`);
    }
    if (n.nodeName === "script" || n.nodeName === "style") {
      const text = n.childNodes?.[0]?.value ?? "";
      if (text.trim()) found.add(`${n.nodeName}-text:${text}`);
    }
    // The ELEMENT itself, not just its attribute value. A URL allowlist cannot catch
    // `<script src="https://evil.example/x.js">` — https is a perfectly good scheme;
    // the problem is that a script element exists at all because of a value. Same for
    // an iframe, an object/embed, a form that posts elsewhere, or a stylesheet link.
    // Safe to flag broadly because this is DIFFED against the control render: the
    // template author's own `<script src="cdn…">` appears in both and is ignored.
    if (LOADS_OR_SENDS.has(n.nodeName)) {
      const key = (n.attrs ?? [])
        .filter((a) => ["src", "href", "data", "action", "srcdoc"].includes(a.name.toLowerCase()))
        .map((a) => `${a.name.toLowerCase()}=${a.value}`)
        .join("|");
      found.add(`element:${n.nodeName}[${key}]`);
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(parseFragment(html) as unknown as Node);
  return found;
}

// Stands in for every value, so the control render exercises the same template with
// nothing dangerous in it. Inert in every position: no scheme, no quote, no angle
// bracket, no whitespace.
const INERT = "lanzasafeplaceholder";

const inertData = (data: Record<string, unknown>): Record<string, unknown> =>
  new Proxy(data, {
    get(target, key: string | symbol): unknown {
      const real = (target as Record<string | symbol, unknown>)[key];
      // Arrays and objects have to keep their SHAPE, or {{#each}} and {{#if}} take
      // different branches and the control render stops being comparable.
      if (Array.isArray(real)) return real.map(() => inertData({}));
      if (real && typeof real === "object") return inertData(real as Record<string, unknown>);
      if (typeof real === "boolean" || real == null) return real;
      return INERT;
    },
    has: () => true,
  }) as Record<string, unknown>;

// Elements DOMPurify is supposed to have removed from a post body. `iframe` is NOT
// here: sanitize.ts deliberately allows it (ADD_TAGS) for legitimate embeds, and
// forces a sandbox on it. Flagging it would fail builds on ordinary content.
const NEVER_IN_A_BODY = new Set(["script", "style", "object", "embed", "form", "base"]);

// For a BODY the rule is scheme-based, not shape-based: a relative URL (`x`,
// `page.html`, `../img.png`) is ordinary in prose and must not be flagged. Only an
// explicit, non-allowlisted scheme is wrong. The stricter SAFE_URL above is right for
// a template VALUE — where a bare word in an href is almost certainly a bug — and
// wrong here. Using it cost a false positive on `<img src="x">`, which is what a
// sanitized `<img src=x onerror=…>` correctly becomes.
const DANGEROUS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BODY_SAFE_SCHEMES = /^(?:https?|mailto|tel):/i;

function bodyUrlIsDangerous(v: string): boolean {
  return DANGEROUS_SCHEME.test(v) && !BODY_SAFE_SCHEMES.test(v);
}

/**
 * Assert that an ALREADY-SANITIZED body carries nothing dangerous.
 *
 * Same reasoning as the template backstop, applied to the other `set:html` sink: post
 * and page bodies are attacker-reachable (the Telegram bot commits raw HTML; an MCP
 * agent writes bodies), and their only defence is DOMPurify being correct. This does
 * not re-sanitize — it checks the OUTPUT with a browser's tokenizer, so a config
 * regression, a version bump that changes behaviour, or an mXSS gadget that survives
 * one pass fails the build instead of shipping.
 *
 * Absolute, not differential: unlike a template, none of a body is author-trusted, so
 * anything on this list is wrong no matter where it came from.
 */
export function assertSanitizedSafe(html: string, where = "body"): string {
  const found: string[] = [];
  const walk = (n: Node): void => {
    if (NEVER_IN_A_BODY.has(n.nodeName)) found.push(`<${n.nodeName}> survived sanitization`);
    for (const a of n.attrs ?? []) {
      const name = a.name.toLowerCase();
      const v = (a.value ?? "").replace(/[\t\n\r]/g, "").trim();
      if (!v) continue;
      if (name.startsWith("on")) found.push(`${name}="${v}"`);
      else if (name === "srcdoc") found.push(`srcdoc="${v.slice(0, 60)}"`);
      else if (n.nodeName === "meta" && name === "content" && /url\s*=/i.test(v)) found.push(`meta refresh="${v}"`);
      else if (URL_ATTRS.has(name) && bodyUrlIsDangerous(v)) found.push(`${n.nodeName}[${name}]="${v.slice(0, 60)}"`);
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(parseFragment(html) as unknown as Node);

  if (found.length) {
    throw new Error(
      `Sanitized ${where} still contains markup a browser would act on — this is a ` +
        `failure of frontend/lib/sanitize.ts, not merely hostile content.\n` +
        found.map((d) => `  • ${d.slice(0, 200)}`).join("\n"),
    );
  }
  return html;
}

/**
 * Render, and throw if a VALUE produced something a browser would treat as dangerous.
 * Returns the rendered HTML so this can wrap the call site directly.
 */
export function renderChecked(template: string, data: Record<string, unknown>, where = "template"): string {
  const html = render(template, data);

  // No try/catch around the control render. An earlier version swallowed a failure here
  // and returned the real HTML unchecked, which meant hostile data could DISABLE the
  // check by making the control render throw — a getter that throws on its second read
  // was enough. A security check that silently turns itself off is the exact pattern
  // this whole sweep kept finding. The control render is the same pure function on the
  // same template, so if it throws while the real one succeeded, something is genuinely
  // wrong and failing the build is the correct outcome.
  const control = dangerousConstructs(render(template, inertData(data)));
  const introduced = [...dangerousConstructs(html)].filter((d) => !control.has(d));

  if (introduced.length) {
    throw new Error(
      `Unsafe value rendered into ${where}. A template value produced markup a browser ` +
        `would act on, which means the template engine misclassified where it landed — ` +
        `report this, it is a bug in frontend/lib/template-render.ts, not just bad data.\n` +
        introduced.map((d) => `  • ${d.slice(0, 200)}`).join("\n"),
    );
  }
  return html;
}
