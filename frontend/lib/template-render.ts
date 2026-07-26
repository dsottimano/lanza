// Minimal HTML TEMPLATE ENGINE — renders author-written HTML templates with page
// data at Astro build time. A Handlebars-ish subset ({{var}}, {{{raw}}}, {{a.b}},
// {{#each}}, {{#if}}, plus loop vars @index/@number), zero dependencies (Dave's
// stdlib-first rule), no partials/helpers/comments/else.
//
// Trust model: the TEMPLATE is author-trusted and emitted VERBATIM — a <style> or
// any markup passes through unescaped. Only interpolated VALUES are untrusted, so
// {{var}} HTML-escapes them. {{{raw}}} emits the value verbatim for values that are
// ALREADY safe HTML — currently only the sanitized page body ({{{ body }}}); don't
// point it at untrusted slot values. (Values still land inside author-trusted
// markup; this engine escapes/emits the value, it doesn't sanitize the template.)
//
// Escaping alone is NOT the whole trust model, because escaping depends on where
// the value lands — see "emitting position" below.

import { isSafeUrl, safeHref } from "./url";

type Scope = Record<string, unknown>;

interface Frame {
  scope: Scope; // the object whose fields resolve by bare name
  index: number; // 0-based position in the enclosing {{#each}}
}

// ── Emitting position ────────────────────────────────────────────────────────
// Where a placeholder sits in the markup decides what "safe" means for its value.
// The only thing that knows the position is the template text immediately before
// the placeholder, so we keep a rolling tail while parsing and classify each
// placeholder once, at parse time.
//
// Two positions need more than the text-node escape set — both are real bug
// classes, not theory:
//
//  - URL attribute (href/src/action/formaction/poster/xlink:href). Escaping does
//    nothing here: the parser decodes entities BEFORE the URL is parsed, so a slot
//    value of `javascript:fetch('/admin/api/gh/…')` survives escaping intact and
//    runs on the site's own origin — the origin that carries the /admin session
//    cookie. The shipped templates put placeholders in href (templates/manifesto,
//    templates/parts/header.html), and frontmatter/slots are agent-writable via the
//    MCP `create_content` tool. So a URL-attribute value must satisfy ./url.ts.
//
//  - UNQUOTED attribute value (`<div class={{c}}>`). The text escape set leaves
//    space, `/`, backtick and `=` alone, so a value can end the attribute and add
//    its own: `x onmouseover=alert(1)`. The two templates we ship happen to quote
//    everything, but the product's core feature is converting arbitrary web HTML
//    into templates, and real HTML is full of unquoted attributes.
// A first cut of this classified position with two regexes against the raw tail. It
// was wrong in both directions, and both were found by executing it rather than
// reading it — worth recording, because the same mistakes are easy to re-introduce:
//
//   * `lastIndexOf("<") > lastIndexOf(">")` is not "inside a tag". A `>` inside an
//     earlier ATTRIBUTE VALUE (`<a title="a>b" href="{{x}}">`) reads as the tag
//     closing, so the href was classified as text and a `javascript:` value survived.
//     Real HTML is full of `>` in title/alt/data-* text. Now scanned with quote state.
//   * Treating every placeholder as a WHOLE URL broke ordinary templates:
//     `href="/blog/{{slug}}"` rendered `/blog/#`, because `slug` alone is not a valid
//     URL. A placeholder that is only PART of a URL cannot introduce a scheme — the
//     literal prefix already fixed it — so it needs escaping, not the URL policy.
interface Position {
  // The value must satisfy the URL policy (./url.ts). Only true where the
  // placeholder can still decide the scheme.
  url: boolean;
  // Literal template text already emitted into this attribute value, before the
  // placeholder. Empty means the placeholder starts the value.
  prefix: string;
  // An unquoted attribute value, or an attribute-NAME position — either can be
  // terminated by whitespace, so the value must not contain any unescaped.
  unquoted: boolean;
  // A context no HTML escaping can make safe: an on* handler (JavaScript) or a
  // style attribute (CSS). Nothing is emitted at all.
  forbidden: boolean;
  // Inside a tag at all. A quoted, non-URL, ordinary attribute (`title="…"`) has
  // url/unquoted/forbidden all false — byte-identical to a text position — so without
  // this bit `renderNodes` could not tell them apart, and emitted `{{{raw}}}` VERBATIM
  // inside the attribute. `title="{{{x}}}"` with `" onmouseover=alert(1) z="` then
  // broke out and installed a live handler. "Already-safe HTML" is a claim that only
  // means anything in a markup position.
  inTag: boolean;
}

const TEXT_POSITION: Position = {
  url: false,
  prefix: "",
  unquoted: false,
  forbidden: false,
  inTag: false,
};

// Attributes whose value is fetched or navigated to. `srcset` and `ping` are here
// because they are URL lists; `content` is not, because it is only a URL under
// `http-equiv=refresh` and treating every meta content as a URL would break ordinary
// templates — a `<meta http-equiv=refresh content="…{{x}}">` template is refused by
// the prefix rule instead, since the value cannot then start the URL.
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

type Node =
  | { t: "text"; v: string }
  | { t: "var"; path: string; pos: Position } // {{x}} — value HTML-escaped for its position
  | { t: "raw"; path: string; pos: Position } // {{{x}}} — value emitted verbatim (already-safe HTML, e.g. the page body)
  | { t: "each"; path: string; body: Node[] }
  | { t: "if"; path: string; body: Node[] };

// Classify from the CURRENT TAG's text, which the Ctx state machine maintains as the
// template is walked (see pushTail). It never searches backwards for a `<`.
//
// That matters: two earlier versions derived "am I inside a tag" by comparing
// `lastIndexOf("<")` and `lastIndexOf(">")` on a window of preceding text, and both
// were bypassable, because a quoted attribute value may legally contain either
// character. `alt="a>b"` broke the first. `alt="a<b>c"` broke the second — the scan
// anchored on the `<` INSIDE the value, so the `>` that followed read as the tag
// closing and the real `href` after it was classified as ordinary text. Raw `<` and
// `>` in attribute text are ordinary in the HTML this engine ingests.
//
// Tracking the state forward, one character at a time, is the only version that
// cannot be fooled by where a lookback happens to land.
function positionOf(ctx: Ctx): Position {
  // Inside <script>/<style> the content is JavaScript or CSS, not HTML — the same
  // reasoning that makes an `on*` attribute `forbidden`. HTML escaping is the wrong
  // tool and gives false comfort: entities do NOT decode inside raw text, so a quoted
  // JS string is inert, but a BACKTICK literal or an unquoted slot is not —
  // `` var s=`{{u}}` `` with `${alert(1)}` executes, and `.a{color:{{u}}}` injects CSS.
  // `escapeHtml` touches none of ` $ { } \.
  //
  // Emitting nothing is a visible failure rather than a silent execution. A template
  // that genuinely needs a value in a script should carry it in a data attribute and
  // read it from there.
  // `raw` is JS/CSS (see below). `unknown` is "a conditional block may have left us
  // inside a tag" — an unknown position must fail CLOSED, and TEXT_POSITION is the
  // least restrictive position there is, so it is exactly the wrong default.
  if (ctx.mode === "raw" || ctx.mode === "unknown") {
    return { url: false, prefix: "", unquoted: false, forbidden: true, inTag: false };
  }
  if (ctx.mode !== "tag") return TEXT_POSITION;
  const tail = ctx.tagText; // always begins with the `<` that opened this tag

  // The element itself, because two attributes are only dangerous on one tag each:
  // `<base href>` retargets every relative URL on the page, and `<meta http-equiv=
  // refresh content>` is a navigation. Both pass an ordinary URL check — an https
  // base is a perfectly valid URL — so the attribute name alone cannot catch them.
  const tagName = (/^<([a-zA-Z][^\s/>]*)/.exec(tail)?.[1] ?? "").toLowerCase();

  let attrName = ""; // the attribute whose value we are inside
  let pending = ""; // characters accumulating into an attribute name
  let lastName = ""; // last completed name, for `href = "…"` with whitespace
  let quote = ""; // "" = unquoted value
  let valueStart = -1;
  let inValue = false;

  for (let i = 1; i < tail.length; i++) {
    const c = tail[i];

    if (inValue) {
      if (quote) {
        if (c === quote) {
          inValue = false;
          quote = "";
          attrName = "";
        }
      } else if (/\s/.test(c)) {
        inValue = false;
        attrName = "";
      } else if (c === ">") {
        return TEXT_POSITION; // unquoted value ended by the tag closing
      }
      continue;
    }

    // Outside a value: a `>` here really does close the tag.
    if (c === ">") return TEXT_POSITION;
    if (c === "=") {
      // `pending` is empty when whitespace separated the name from the `=`
      // (`<a href = "…">`, or a newline between them). HTML allows that, so falling
      // back to the last completed name is what stops `href\n=\n"{{x}}"` from
      // classifying as a non-URL attribute and waving a `javascript:` value through.
      attrName = (pending || lastName).toLowerCase();
      pending = "";
      lastName = "";
      let j = i + 1;
      while (j < tail.length && /\s/.test(tail[j])) j++;
      if (tail[j] === '"' || tail[j] === "'") {
        quote = tail[j];
        j++;
      }
      inValue = true;
      valueStart = j;
      i = j - 1;
      continue;
    }
    // `/` separates attribute names to the HTML tokenizer exactly as whitespace does,
    // so `<a/href="…">` really is an `href` to a browser. Treating it as a name
    // character instead produced the name `a/href`, which matched no rule at all —
    // evading both the URL policy and the `forbidden` set. `html-minifier` emits
    // precisely this shape, so it arrives in converted markup.
    if (/[\s/]/.test(c)) {
      if (pending) lastName = pending;
      pending = "";
      continue;
    }
    pending += c;
  }

  // Ended outside any value: the placeholder sits where an attribute NAME goes
  // (`<a {{x}}>`). A value of `onmouseover=alert(1)` would become a live handler, so
  // treat it as unquoted — that escapes whitespace and `=`, which is exactly what
  // stops it forming a new attribute.
  if (!inValue) return { url: false, prefix: "", unquoted: true, forbidden: false, inTag: true };

  // An event handler is a JavaScript context and `style` is a CSS one. HTML escaping
  // is the wrong tool for both — entities decode before the JS/CSS parser runs — so
  // nothing is emitted rather than something that looks escaped and isn't.
  // `srcdoc` is the subtlest of these: escaping it LOOKS right, and it is not. The
  // HTML parser entity-decodes an attribute value and then parses `srcdoc` as a whole
  // document, so `&lt;script&gt;` becomes a live `<script>` inside the frame — and a
  // srcdoc frame inherits this origin. Unlike a post body, a template-rendered iframe
  // never passes through DOMPurify, so nothing downstream catches it either.
  //
  // A DYNAMIC sentinel in the attribute NAME means the name itself came from data
  // (`<a {{n}}="{{v}}">`, `<a hr{{n}}ef="…">`). We cannot know what attribute this is,
  // so we cannot know which policy applies — and an unknown position must fail closed.
  // Left as "ordinary attribute" it matched no rule at all, so `n="onclick"` produced a
  // live handler and `n="href"` bypassed the URL policy, both from data alone.
  if (
    attrName.startsWith("on") ||
    attrName === "style" ||
    attrName === "srcdoc" ||
    attrName.includes(DYNAMIC) ||
    (tagName === "base" && attrName === "href") ||
    (tagName === "meta" && attrName === "content")
  ) {
    return { url: false, prefix: "", unquoted: !quote, forbidden: true, inTag: true };
  }

  return {
    url: URL_ATTRS.has(attrName),
    prefix: tail.slice(valueStart),
    unquoted: !quote,
    forbidden: false,
    inTag: true,
  };
}

function escapeHtml(s: string, unquotedAttr = false): string {
  const out = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  // Only an unquoted attribute value can be terminated by these. Escaping them
  // everywhere would turn every space in every sentence into &#32;, so it is scoped
  // to the position that actually needs it.
  return unquotedAttr ? out.replace(/[\s/`=]/g, (c) => `&#${c.charCodeAt(0)};`) : out;
}

// Split on {{...}} into interleaved text and tag tokens, then build the AST with a
// recursive descent driven by a cursor. Block tags ({{#each}}/{{#if}}) recurse
// until their matching {{/each}}/{{/if}}.
function tokenize(template: string): string[] {
  // Triple-brace ({{{raw}}}) must be tried before double so its braces aren't
  // mis-split as an empty double-brace tag.
  return template.split(/(\{\{\{[^}]*\}\}\}|\{\{[^}]*\}\})/);
}

// Tag state, advanced one character at a time as the template is walked. Threaded
// through the recursion so a placeholder inside an {{#each}} body still sees the
// markup it is nested in.
// Modes mirror the HTML tokenizer closely enough that markup which is NOT markup
// cannot corrupt the state:
//   text    — between tags
//   maybe   — just saw `<`, deciding what it starts (a tag? a comment? nothing?)
//   tag     — inside `<… >`; this is the only mode a placeholder can be classified in
//   comment — inside `<!-- … -->`; contains no markup
//   bogus   — `<!doctype …>`, `<?… >`; ends at the first `>`
//   raw     — inside <script>/<style>/<title>/<textarea>; ends only at its close tag
//   unknown — we cannot say where we are. Nothing is emitted here; see the block
//             rewind in parse(). Tokenises like `bogus` (resyncs at the next `>`).
type Mode = "text" | "maybe" | "tag" | "comment" | "bogus" | "raw" | "unknown";

interface Ctx {
  mode: Mode;
  tagText: string; // from the opening `<` to the cursor; "" outside a tag
  quote: string; // the quote holding the current attribute value, else ""
  afterEquals: boolean; // a quote only opens a VALUE directly after `=`
  buf: string; // small lookahead while deciding `maybe`, and close-tag search in `raw`
  rawTag: string; // which raw-text element we are inside
  // Depth inside <svg>/<math>. In foreign content `title` and `textarea` are ORDINARY
  // elements whose children are parsed as markup — only in HTML are they raw text. The
  // rule is namespace-dependent, so the tokenizer needs to know which namespace it is
  // in, or `<svg><title><a href="{{u}}">` renders a live SVG anchor.
  foreign: number;
}

export function newCtx(): Ctx {
  return { mode: "text", tagText: "", quote: "", afterEquals: false, buf: "", rawTag: "", foreign: 0 };
}

// Elements whose content is text, not markup. A `<` or a quote inside one of these is
// ordinary data — the HTML tokenizer does not look for tags until the close tag.
const RAW_TEXT = ["script", "style", "title", "textarea"];

// A placeholder's future value is not literal template text, so it is recorded as this
// sentinel rather than as a stand-in character. `urlValue` keys off it: a URL prefix
// containing one is a prefix whose CONTENT IS NOT KNOWN HERE, which means it cannot be
// relied on to have settled the scheme. C1 control character — it cannot occur in real
// markup, and if it somehow did the only effect is to be more conservative.
const DYNAMIC = "\u0001";

// Advance the tag state over a run of template text.
//
// Nothing outside a tag is retained: once a tag has closed, its text can never change
// how a later placeholder is classified. Inside a tag, everything since the `<` is
// kept — which is also what fixed an earlier failure where a fixed-size window dropped
// the opening `<` behind a long attribute (a Tailwind class list, an SVG `d=`) and the
// classifier then failed OPEN, seeing no tag at all.
// Constructs that are NOT markup have to be skipped, or their contents corrupt the
// state and every tag after them is misread. Each of these was a live bypass:
//
//   `<!-- don't -->`            an apostrophe in a COMMENT opened an attribute value
//                               that never closed, so the next real `href` was swallowed
//                               as attribute text and never classified. An English
//                               contraction inside a comment is about as ordinary as
//                               markup gets.
//   `<!-- a" -->`               the same with a double quote.
//   `<style>a[b="<"]{}</style>` a `<` inside a CSS string opened a phantom tag.
//   `<title><a href="</title>`  raw text read as markup.
//
// A quote also only opens a value directly after `=`; `<a "x" href="…">` must not put
// the tokenizer inside a value.
function pushTail(ctx: Ctx, s: string): void {
  for (const c of s) {
    switch (ctx.mode) {
      case "text":
        if (c === "<") {
          ctx.mode = "maybe";
          ctx.buf = "<";
        }
        break;

      case "maybe": {
        ctx.buf += c;
        if (ctx.buf === "<!") break; // still deciding: comment or doctype
        if (ctx.buf === "<!-") break;
        if (ctx.buf === "</") break; // an end tag — the name is the next character
        if (ctx.buf === "<!--") {
          ctx.mode = "comment";
          // `<!-->` and `<!--->` are COMPLETE comments per spec: the terminator may
          // start immediately. Seeding the run of dashes here is what lets them close.
          ctx.buf = "--";
          break;
        }
        if (ctx.buf.startsWith("<!") || ctx.buf.startsWith("<?")) {
          ctx.mode = "bogus";
          ctx.buf = "";
          break;
        }
        // `<` followed by a name char (or `/`) opens a tag; anything else — `a < b` in
        // prose — is just text.
        if (/^<\/?[a-zA-Z]/.test(ctx.buf)) {
          ctx.mode = "tag";
          ctx.tagText = ctx.buf;
          ctx.quote = "";
          ctx.afterEquals = false;
          ctx.buf = "";
          if (c === ">") closeTag(ctx);
        } else {
          // Not a tag after all. The character that ended the decision has NOT been
          // consumed yet — and if it is `<` it starts a new one. Dropping it made
          // `<<a href="{{u}}">` skip the tag entirely (a browser reads the first `<`
          // as text, the second as the tag open), so reprocess it here.
          ctx.mode = "text";
          ctx.buf = "";
          if (c === "<") {
            ctx.mode = "maybe";
            ctx.buf = "<";
          }
        }
        break;
      }

      case "comment":
        // Three spec terminators, not one. `-->` is the common exit; `--!>` is the
        // comment-end-bang state; and a comment opened as `<!-->`/`<!--->` closes on
        // the dashes seeded above. Missing any of them left the tokenizer inside a
        // comment FOREVER — every placeholder in the rest of the template then read as
        // plain text, which silently disabled the URL policy, the `forbidden` set and
        // the unquoted-attribute escaping all at once.
        ctx.buf = (ctx.buf + c).slice(-4);
        if (ctx.buf.endsWith("-->") || ctx.buf.endsWith("--!>")) {
          ctx.mode = "text";
          ctx.buf = "";
        }
        break;

      case "bogus":
      case "unknown":
        if (c === ">") ctx.mode = "text";
        break;

      case "raw": {
        ctx.buf = (ctx.buf + c).slice(-(ctx.rawTag.length + 2)).toLowerCase();
        if (ctx.buf === `</${ctx.rawTag}`) {
          // The close tag itself is a tag; let it be parsed as one so its `>` lands.
          ctx.mode = "tag";
          ctx.tagText = ctx.buf;
          ctx.quote = "";
          ctx.afterEquals = false;
          ctx.buf = "";
          ctx.rawTag = "";
        }
        break;
      }

      case "tag":
        ctx.tagText += c;
        if (ctx.quote) {
          if (c === ctx.quote) {
            ctx.quote = "";
            ctx.afterEquals = false;
          }
        } else if (ctx.afterEquals && (c === '"' || c === "'")) {
          ctx.quote = c;
          ctx.afterEquals = false;
        } else if (c === "=") {
          ctx.afterEquals = true;
        } else if (c === ">") {
          closeTag(ctx);
        } else if (!/\s/.test(c)) {
          ctx.afterEquals = false;
        }
        break;
    }
  }
}

// A tag just ended. If it opened a raw-text element, its CONTENT is text rather than
// markup, so switch to that mode instead of back to ordinary text.
function closeTag(ctx: Ctx): void {
  const raw = ctx.tagText;
  const name = (/^<([a-zA-Z][^\s/>]*)/.exec(raw)?.[1] ?? "").toLowerCase();
  const endTag = /^<\//.test(raw);
  const selfClosing = /\/>$/.test(raw + ">");
  ctx.tagText = "";
  ctx.quote = "";
  ctx.afterEquals = false;
  ctx.buf = "";

  // Track the foreign-content namespace (see Ctx.foreign).
  const closeName = endTag ? (/^<\/([a-zA-Z][^\s/>]*)/.exec(raw)?.[1] ?? "").toLowerCase() : "";
  if (!endTag && (name === "svg" || name === "math") && !selfClosing) ctx.foreign++;
  else if (endTag && (closeName === "svg" || closeName === "math")) ctx.foreign = Math.max(0, ctx.foreign - 1);

  // Raw text is an HTML-namespace rule only: inside <svg>/<math>, `title` and
  // `textarea` are ordinary elements and their contents ARE markup.
  if (!endTag && RAW_TEXT.includes(name) && !(ctx.foreign > 0 && name !== "script" && name !== "style")) {
    ctx.mode = "raw";
    ctx.rawTag = name;
  } else {
    ctx.mode = "text";
  }
}

function parse(
  tokens: string[],
  start: number,
  ctx: Ctx,
  stop?: string,
): { nodes: Node[]; next: number } {
  const nodes: Node[] = [];
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i];
    const raw = /^\{\{\{\s*(.*?)\s*\}\}\}$/.exec(tok);
    if (raw) {
      nodes.push({ t: "raw", path: raw[1].trim(), pos: positionOf(ctx) });
      pushTail(ctx, DYNAMIC); // its value is not known here — see urlValue
      i++;
      continue;
    }
    const m = /^\{\{\s*(.*?)\s*\}\}$/.exec(tok);
    if (!m) {
      if (tok) nodes.push({ t: "text", v: tok });
      pushTail(ctx, tok);
      i++;
      continue;
    }
    const inner = m[1];
    if (stop && inner.replace(/\s+/g, "") === stop) {
      return { nodes, next: i + 1 };
    }
    const each = /^#each\s+(.+)$/.exec(inner);
    const iff = /^#if\s+(.+)$/.exec(inner);
    if (each || iff) {
      // A block's body is CONDITIONAL: `{{#if p}}/p{{/if}}` contributes `/p` at parse
      // time but nothing at render time when `p` is false. Letting that text stand as
      // a literal prefix made `href="{{#if p}}/p{{/if}}{{u}}"` fail open — the URL
      // check saw `/p` + value and passed it, then emitted the value ALONE, so a bare
      // `javascript:` became the whole href.
      //
      // So: let the body parse against the real state (its own placeholders need
      // accurate positions), then rewind and record the block as one DYNAMIC
      // contribution. Everything after it treats the block's output as unknown, which
      // is exactly what it is.
      const before = { ...ctx };
      const parsed = parse(tokens, i + 1, ctx, each ? "/each" : "/if");
      nodes.push(
        each
          ? { t: "each", path: each[1].trim(), body: parsed.nodes }
          : { t: "if", path: iff![1].trim(), body: parsed.nodes },
      );
      // Rewinding is right for the PREFIX and wrong for the tag STATE. A body that
      // opens a tag and does not close it (`{{#if a}}<a href="{{/if}}{{u}}">`) leaves
      // the browser inside that tag while a rewind puts us back in "text" — which is
      // fail-OPEN, because text is the least restrictive position there is.
      //
      // So: rewind only when the body left the state exactly as it found it. If it
      // didn't, we do not know where we are, and an unknown position must fail closed —
      // `bogus` classifies as non-tag but, unlike `text`, is not a position any
      // placeholder is emitted into unguarded.
      const unchanged = ctx.mode === before.mode && ctx.tagText === before.tagText && ctx.quote === before.quote;
      if (unchanged) Object.assign(ctx, before);
      else ctx.mode = "unknown";
      pushTail(ctx, DYNAMIC);
      i = parsed.next;
    } else {
      nodes.push({ t: "var", path: inner, pos: positionOf(ctx) });
      pushTail(ctx, DYNAMIC);
      i++;
    }
  }
  return { nodes, next: i };
}

// Resolve a bare name from the top frame downward (first frame that owns the key
// wins); @index/@number come from loop metadata, not data. Dotted paths walk into
// the resolved root.
function resolve(path: string, stack: Frame[]): unknown {
  const top = stack[stack.length - 1];
  if (path === "@index") return top ? top.index : undefined;
  if (path === "@number") return top ? String(top.index + 1).padStart(2, "0") : undefined;
  const parts = path.split(".");
  const head = parts[0];
  let value: unknown;
  let found = false;
  for (let i = stack.length - 1; i >= 0; i--) {
    const scope = stack[i].scope;
    if (scope != null && typeof scope === "object" && head in (scope as Scope)) {
      value = (scope as Scope)[head];
      found = true;
      break;
    }
  }
  if (!found) return undefined;
  for (let i = 1; i < parts.length; i++) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Scope)[parts[i]];
  }
  return value;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function stringify(v: unknown, pos: Position): string {
  if (v == null) return "";
  if (typeof v === "object") return ""; // don't print [object Object] / arrays
  if (pos.forbidden) return ""; // JS/CSS context — see positionOf
  const s = String(v);
  return escapeHtml(pos.url ? urlValue(s, pos.prefix) : s, pos.unquoted);
}

// What a placeholder may contribute to a URL attribute depends on whether it can
// still choose the SCHEME.
//
//   href="{{u}}"            → the value is the whole URL; apply the policy.
//   href="/blog/{{slug}}"   → `/blog/` already fixed the scheme, so `slug` is an
//                             ordinary path segment. Applying the policy here is what
//                             turned every such template into `/blog/#`.
//
// The middle case still has to be checked, not waved through: `href="java{{x}}"` with
// x = `script:alert(1)` composes a scheme out of two halves. So the prefix and the
// value are tested TOGETHER, and a combination that isn't a safe URL contributes
// nothing — leaving the literal prefix, which is the template author's own text.
function urlValue(value: string, prefix: string): string {
  if (!prefix) return safeHref(value);
  // A prefix containing anything whose output is decided at RENDER time — another
  // placeholder, or a {{#if}}/{{#each}} body — cannot be trusted to have settled the
  // scheme, because it may render to nothing and leave this value first. So the policy
  // applies to the value on its own.
  //
  // This is why the marker is a sentinel rather than a stand-in character: an earlier
  // version pushed the literal `"x"` and tested `prefix.includes("{{")`, which could
  // never match — it was dead code, and the case was only saved by the accident that
  // `isSafeUrl("x" + value)` happens to be false.
  //
  // Consequence: `href="{{base}}/{{path}}"` renders its path as `#`. Deliberate — a
  // template should carry a whole URL in one placeholder.
  if (prefix.includes(DYNAMIC)) return safeHref(value);
  return isSafeUrl(prefix + value) ? value : "";
}

function renderNodes(nodes: Node[], stack: Frame[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.t === "text") {
      out += node.v;
    } else if (node.t === "var") {
      out += stringify(resolve(node.path, stack), node.pos);
    } else if (node.t === "raw") {
      const v = resolve(node.path, stack);
      if (v == null || typeof v === "object") continue;
      // "Emit verbatim" means "this is already-safe HTML", and that claim only makes
      // sense in a MARKUP position. Anywhere inside a tag, the value is not HTML at
      // all — it is a URL, an attribute name, or a JS/CSS fragment — so a raw is
      // treated exactly like a var there. `<a {{{attrs}}}>` was otherwise a live
      // event-handler injection with no policy applied at all.
      const inMarkup = !node.pos.inTag;
      out += inMarkup ? String(v) : stringify(v, node.pos);
    } else if (node.t === "if") {
      if (truthy(resolve(node.path, stack))) out += renderNodes(node.body, stack);
    } else {
      const items = resolve(node.path, stack);
      if (Array.isArray(items)) {
        items.forEach((item, index) => {
          stack.push({ scope: item as Scope, index });
          out += renderNodes(node.body, stack);
          stack.pop();
        });
      }
    }
  }
  return out;
}

export function render(template: string, data: Record<string, unknown>): string {
  const { nodes } = parse(tokenize(template), 0, newCtx());
  return renderNodes(nodes, [{ scope: data, index: 0 }]);
}
