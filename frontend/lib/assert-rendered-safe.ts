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
// The walk itself now lives under functions/, because the site-system checker needs
// the same answer about an AGENT-written template — and a second implementation of
// "what would a browser act on" is the last thing this file's history recommends.
// That module reads the findings ABSOLUTELY (an agent-written template has no trusted
// author); this file diffs two renders and reports only what a VALUE introduced.
import { dangerousConstructs, URL_ATTRS } from "../../functions/_lib/dangerous-constructs.mjs";

export { URL_ATTRS };

interface Node {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: Node[];
  value?: string;
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
  const control = new Set(dangerousConstructs(render(template, inertData(data))).map((d) => d.key));
  const introduced = dangerousConstructs(html)
    .filter((d) => !control.has(d.key))
    .map((d) => d.key);

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
