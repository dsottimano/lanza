// Adversarial tests for the HTML template engine (frontend/lib/template-render.ts)
// and the shared URL policy (frontend/lib/url.ts).
//
// The engine renders author-written templates with PAGE DATA, and page data is
// attacker-reachable: the MCP `create_content` tool merges arbitrary `frontmatter`
// (including `slots`) with no validation, and frontend/content.config.ts types slots
// as z.record(z.string(), z.any()). The shipped templates put those slots straight
// into href attributes, so "escaped" was never enough — the HTML parser decodes
// entities BEFORE the URL is parsed.
//
// Why this matters more than ordinary XSS: script that runs on the site's own origin
// is script that can fetch /admin/api/gh/* with the Path=/admin session cookie
// attached — whole-repo write. So each case asserts the payload is REFUSED and that
// no live form of it survives anywhere in the output.
// Run: node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs functions/_lib/template-render.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "../../frontend/lib/template-render.ts";
import { isSafeUrl, safeHref } from "../../frontend/lib/url.ts";
// parse5 is the SPEC tokenizer — the same one a browser uses. Every bug this file has
// had was the engine disagreeing with a real parser about where a value landed, and a
// string assertion can only catch a payload someone already imagined. Parsing the
// RENDERED output and asking what a browser sees catches misclassifications nobody
// thought of, which is the entire failure mode here.
//
// Test-only, and not a new dependency: parse5 is already in the tree via
// isomorphic-dompurify -> jsdom.
import { parseFragment } from "parse5";

const ORACLE_URL_ATTRS = new Set([
  "href", "src", "srcset", "action", "formaction", "poster", "xlink:href", "cite", "ping", "data",
]);
const ORACLE_SAFE = /^(https?:|mailto:|tel:|#|\/(?![/\\]))/i;

/** Everything a browser would treat as dangerous in this rendered HTML. */
function browserDanger(html) {
  const found = [];
  const walk = (n) => {
    for (const a of n.attrs ?? []) {
      const name = a.name.toLowerCase();
      const v = (a.value ?? "").replace(/[\t\n\r]/g, "").trim();
      if (!v) continue;
      if (name.startsWith("on")) found.push(`${name}="${v}"`);
      else if (name === "srcdoc") found.push(`srcdoc="${v.slice(0, 40)}"`);
      else if (name === "style" && /url\(|expression/i.test(v)) found.push(`style="${v.slice(0, 40)}"`);
      else if (n.nodeName === "base" && name === "href") found.push(`base href="${v}"`);
      else if (ORACLE_URL_ATTRS.has(name) && !ORACLE_SAFE.test(v)) found.push(`${n.nodeName}[${name}]="${v.slice(0, 40)}"`);
    }
    if ((n.nodeName === "script" || n.nodeName === "style") && /alert\(1\)|evil/.test(n.childNodes?.[0]?.value ?? "")) {
      found.push(`${n.nodeName} text: ${(n.childNodes[0].value || "").slice(0, 40)}`);
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(parseFragment(html));
  return found;
}

function assertBrowserSafe(html, label) {
  const d = browserDanger(html);
  assert.deepEqual(d, [], `${label ?? "render"} -> browser sees: ${d.join("; ")}\n${html}`);
}

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// A rendered page is safe from this payload only if NOTHING in it can still be read
// as the scheme — not the literal, not an entity-encoded form the parser would decode
// back before parsing the URL.
function assertNoLiveScheme(html, scheme = "javascript") {
  assert.ok(!html.toLowerCase().includes(`${scheme}:`), `literal ${scheme}: survived`);
  // `javascript&#58;…` / `javascript&colon;…` decode to the scheme inside an attribute.
  assert.ok(!/&#0*58;?|&colon;/i.test(html), "an entity-encoded colon survived");
}

test("URL policy: schemes are an allowlist, not a javascript: blocklist", () => {
  for (const ok of [
    "https://example.com/x",
    "http://example.com",
    "mailto:a@b.c",
    "tel:+15551234",
    "/about",
    "/",
    "#pricing",
  ]) {
    assert.ok(isSafeUrl(ok), ok);
    assert.equal(safeHref(ok), ok);
  }
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "\njavascript:alert(1)", // leading whitespace the parser strips
    " javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "//evil.example.com", // protocol-relative: an absolute URL to another host
    "\\\\evil.example.com",
  ]) {
    assert.ok(!isSafeUrl(bad), bad);
    assert.equal(safeHref(bad), "#", bad);
  }
});

test("a javascript: slot in an href renders as #, in every quoting style", () => {
  const payload = "javascript:fetch('/admin/api/gh/contents/x',{method:'PUT'})";
  for (const tpl of [
    `<a href="{{ u }}">go</a>`,
    `<a href='{{ u }}'>go</a>`,
    `<a href={{ u }}>go</a>`,
    `<img src="{{ u }}">`,
    `<form action="{{ u }}"><button formaction="{{ u }}">x</button></form>`,
    `<video poster="{{ u }}"></video>`,
    `<svg><use xlink:href="{{ u }}"/></svg>`,
  ]) {
    const out = render(tpl, { u: payload });
    assertNoLiveScheme(out);
    assert.ok(out.includes("#"), tpl);
  }
});

test("{{{raw}}} in a URL attribute is a URL, not 'already-safe HTML'", () => {
  const out = render(`<a href="{{{ u }}}">go</a>`, { u: "javascript:alert(1)" });
  assertNoLiveScheme(out);
  assert.equal(out, `<a href="#">go</a>`);
  // Outside a URL attribute {{{raw}}} still emits verbatim — that is what the
  // sanitized page body relies on.
  assert.equal(render(`<div>{{{ body }}}</div>`, { body: "<b>hi</b>" }), "<div><b>hi</b></div>");
});

test("entity-encoding the scheme does not smuggle it past the policy", () => {
  // The old engine escaped & < > \" ' and emitted this intact; the parser then
  // decoded it back to javascript: before parsing the URL.
  const out = render(`<a href="{{ u }}">go</a>`, { u: "javascript&#58;alert(1)" });
  assertNoLiveScheme(out);
});

test("an UNQUOTED attribute cannot be broken out of to add an event handler", () => {
  const out = render(`<div class={{ c }}>x</div>`, { c: "a onmouseover=alert(1) b" });
  assert.ok(!/\sonmouseover\s*=/i.test(out), out);
  // The value is still fully recoverable by the parser as one attribute value.
  assert.equal(out, `<div class=a&#32;onmouseover&#61;alert(1)&#32;b>x</div>`);
});

test("unquoted breakout via slash / backtick / newline is closed too", () => {
  for (const payload of ["x/onload=alert(1)", "x`onload=alert(1)", "x\nonload=alert(1)"]) {
    const out = render(`<div id={{ c }}>x</div>`, { c: payload });
    assert.ok(!/\son(load|mouseover)\s*=/i.test(out), out);
    assert.ok(!out.includes("`"), out);
  }
});

test("no over-escaping: ordinary text and quoted attributes are untouched", () => {
  // Escaping space/slash everywhere would turn every sentence into &#32; soup.
  assert.equal(render(`<p>{{ t }}</p>`, { t: "Own your site / your words" }), "<p>Own your site / your words</p>");
  assert.equal(render(`<div class="{{ c }}">x</div>`, { c: "a b" }), `<div class="a b">x</div>`);
  // Prose that merely MENTIONS href= is not an attribute position.
  assert.equal(render(`<code>href="{{ t }}"</code>`, { t: "javascript:x" }), `<code>href="javascript:x"</code>`);
  // data-href / srcset are not URL attributes and must not be mistaken for them.
  assert.equal(render(`<i data-href="{{ u }}">`, { u: "javascript:x" }), `<i data-href="javascript:x">`);
});

test("legitimate URLs still render: https, root-relative, anchor, mailto", () => {
  for (const url of ["https://connect.lanzacms.com/", "/how-it-works", "#pricing", "mailto:a@b.c"]) {
    assert.equal(render(`<a href="{{ u }}">x</a>`, { u: url }), `<a href="${url}">x</a>`);
  }
  // A query string keeps its & escaped — correct, and the browser decodes it back.
  assert.equal(
    render(`<a href="{{ u }}">x</a>`, { u: "https://x.test/?a=1&b=2" }),
    `<a href="https://x.test/?a=1&amp;b=2">x</a>`,
  );
});

test("a second placeholder in the same attribute is still a URL position", () => {
  const out = render(`<a href="{{ a }}{{ b }}">x</a>`, { a: "/p", b: "javascript:alert(1)" });
  assertNoLiveScheme(out);
});

// ── The real shipped templates, not a fixture ────────────────────────────────
test("REAL templates/manifesto/template.html: a javascript: CTA renders as #", () => {
  const tpl = readFileSync(`${REPO_ROOT}templates/manifesto/template.html`, "utf8");
  const payload = "javascript:fetch('/admin/api/gh/contents/lanza.config.json')";
  const out = render(tpl, {
    tag: "Lanza",
    headline: "Own your site",
    cta1: "Start", cta1Url: payload,
    cta2: "How it works", cta2Url: "/how-it-works",
    closeCta: "Start", closeCtaUrl: payload,
    cards: [{ who: "Devs", body: "…", cta: "Read", href: payload }],
  });
  assertNoLiveScheme(out);
  assert.ok(out.includes('href="#"'), "the CTA should have collapsed to an inert #");
  // The legitimate CTA beside it is untouched.
  assert.ok(out.includes('href="/how-it-works"'));
});

test("REAL templates/parts/header.html + footer.html: a javascript: menu item renders as #", () => {
  const menu = [{ label: "Evil", url: "javascript:alert(document.cookie)" }, { label: "Blog", url: "/posts" }];
  for (const part of ["header", "footer"]) {
    const tpl = readFileSync(`${REPO_ROOT}templates/parts/${part}.html`, "utf8");
    const out = render(tpl, {
      siteName: "Lanza", homeUrl: "/", year: 2026,
      menuHeader: menu, menuFooter: menu,
    });
    assertNoLiveScheme(out);
    assert.ok(out.includes('href="#"'), part);
    assert.ok(out.includes('href="/posts"'), part);
  }
});

// ── Found by the red-team pass on the first version of this fix ──────────────
// Every case below was a working bypass or a real regression. They are grouped so
// that reverting any single guard in positionOf()/urlValue() fails a named test.

test("a `>` inside an earlier attribute value does not end the tag", () => {
  // The first cut used lastIndexOf("<") > lastIndexOf(">"), so a `>` in title/alt/
  // data-* read as the tag closing, the href was classified as TEXT, and the URL
  // policy never ran. `>` in attribute text is ordinary in real HTML.
  for (const tpl of [
    `<a title="a>b" href="{{u}}">t</a>`,
    `<a data-tip="click >here" href="{{u}}">t</a>`,
    `<img alt="1>2" src="{{u}}">`,
  ]) {
    const out = render(tpl, { u: "javascript:alert(1)" });
    assertNoLiveScheme(out);
    assert.ok(out.includes('="#"'), tpl);
  }
});

test("whitespace between an attribute name and its `=` still classifies as a URL", () => {
  // HTML allows `href = "…"` and a newline in place of the space. The scanner reset
  // the pending name on whitespace, so the attribute read as unnamed and skipped the
  // policy entirely.
  assertNoLiveScheme(render(`<a href\n=\n"{{u}}">t</a>`, { u: "javascript:alert(1)" }));
  assertNoLiveScheme(render(`<a href = {{u}}>t</a>`, { u: "javascript:alert(1)" }));
});

test("a placeholder in attribute-NAME position cannot invent an attribute", () => {
  // `<a {{attrs}}>` supplies its own `=`, so the unquoted-value test never matched.
  for (const tpl of [`<a {{attrs}}>t</a>`, `<a class="c" {{attrs}}>t</a>`]) {
    const out = render(tpl, { attrs: "onmouseover=alert(1) x" });
    assert.ok(!/\sonmouseover=alert\(1\)/.test(out), tpl);
  }
  // …and {{{raw}}} gets the same treatment there: "already-safe HTML" is a claim that
  // only means anything in a markup position.
  const raw = render(`<a {{{attrs}}}>t</a>`, { attrs: "onmouseover=alert(1)" });
  assert.ok(!/\sonmouseover=alert\(1\)/.test(raw), raw);
});

test("positions no escaping can make safe emit nothing", () => {
  // srcdoc is entity-DECODED and then parsed as a document, so escaping it produces
  // a live <script> inside a frame that inherits this origin.
  assert.ok(!render(`<iframe srcdoc="{{x}}"></iframe>`, { x: "<script>alert(1)</script>" }).includes("alert"));
  // JS and CSS contexts.
  assert.ok(!render(`<div onclick="{{x}}">t</div>`, { x: "alert(1)" }).includes("alert"));
  assert.ok(!render(`<div style="background:url({{x}})">t</div>`, { x: "javascript:alert(1)" }).includes("javascript"));
  // <base href> retargets every relative URL on the page and <meta refresh> is a
  // navigation — both pass an ordinary URL check, so the attribute name is not enough.
  assert.ok(!render(`<base href="{{x}}">`, { x: "https://evil.example" }).includes("evil"));
  assert.ok(!render(`<meta http-equiv="refresh" content="0;url={{x}}">`, { x: "https://evil.example" }).includes("evil"));
});

test("a placeholder that is only PART of a URL is not treated as a whole one", () => {
  // The first cut ran safeHref on every placeholder, so `/blog/{{slug}}` became
  // `/blog/#` — silently, with no build error. Composed URLs are the norm in HTML
  // converted from the web, which is the product's core feature.
  const cases = [
    [`<a href="/blog/{{v}}">x</a>`, "my-post", 'href="/blog/my-post"'],
    [`<img src="/images/{{v}}">`, "photo.jpg", 'src="/images/photo.jpg"'],
    [`<a href="/search?q={{v}}">x</a>`, "hello", 'href="/search?q=hello"'],
    [`<a href="mailto:{{v}}">x</a>`, "a@b.com", 'href="mailto:a@b.com"'],
    [`<a href="#{{v}}">x</a>`, "pricing", 'href="#pricing"'],
  ];
  for (const [tpl, v, expected] of cases) {
    assert.ok(render(tpl, { v }).includes(expected), `${tpl} -> ${render(tpl, { v })}`);
  }
  // …but a value that COMPLETES a scheme across the seam is still refused.
  assertNoLiveScheme(render(`<a href="java{{v}}">x</a>`, { v: "script:alert(1)" }));
});

test("root-relative means root-relative: `\\` and stripped control chars are not", () => {
  // WHATWG treats `\` as a path separator and strips TAB/LF/CR anywhere in a URL, so
  // `/\evil.example` and `/<TAB>/evil.example` both resolve to another host while
  // looking like a safe root-relative path to a naive startsWith("//") test.
  for (const u of ["/\\evil.example", "/\\/evil.example", "/\t/evil.example", "//evil.example"]) {
    assert.equal(isSafeUrl(u), false, `must refuse ${JSON.stringify(u)}`);
    assert.ok(render(`<a href="{{u}}">x</a>`, { u }).includes('href="#"'), JSON.stringify(u));
  }
  // Ordinary root-relative paths still pass.
  for (const u of ["/about", "/blog/post-1", "/a?b=c#d"]) assert.equal(isSafeUrl(u), true, u);
});

test("a long attribute cannot push the opening `<` out of the classifier's view", () => {
  // The tail was a flat 256-char window, so 300 characters of `class` before the
  // placeholder dropped the `<` and positionOf saw no tag at all — classifying an
  // href as ordinary TEXT and failing OPEN. Long class lists and inline SVG path
  // data are completely ordinary in the HTML this engine is built to ingest.
  const pad = "A".repeat(1000);
  for (const tpl of [
    `<a class="${pad}" href="{{u}}">t</a>`,
    `<a data-x="${pad}" title="t" href="{{u}}">t</a>`,
    `<svg><path d="${pad}"/><a xlink:href="{{u}}">t</a></svg>`,
  ]) {
    const out = render(tpl, { u: "javascript:alert(1)" });
    assertNoLiveScheme(out);
    assert.ok(out.includes('="#"'), tpl.slice(0, 40));
  }
  // A long TEXT node before the tag must still classify as text — no over-escaping.
  const prose = render(`${"word ".repeat(200)}<a href="{{u}}">t</a>`, { u: "/ok" });
  assert.ok(prose.includes('href="/ok"'));
  assert.ok(!prose.includes("&#32;"), "ordinary prose must not be attribute-escaped");
});

// ── Round 2: found by attacking the FIX rather than the original bug ─────────
// Each of these was live after the first rewrite. The scanner no longer looks
// backwards for a `<` at all — Ctx tracks tag state forward, one character at a time.

test("`<` AND `>` inside an earlier attribute value do not end the tag", () => {
  // Round 1 fixed `alt="a>b"` by seeking back to the last `<`. That moved the bug:
  // with `alt="a<b>c"` the seek landed on the `<` INSIDE the value, so the following
  // `>` read as the tag closing and the real href was classified as text.
  const out = [
    [`<a alt="a<b>c" href="{{u}}">t</a>`, "javascript:alert(1)"],
    [`<a title="use <em>x</em>" href="{{u}}">t</a>`, "javascript:alert(1)"],
    [`<img data-tpl="<li>" src="{{u}}">`, "javascript:alert(1)"],
  ];
  for (const [tpl, u] of out) {
    const html = render(tpl, { u });
    assertNoLiveScheme(html);
    assert.ok(html.includes('="#"'), tpl);
  }
  // The `forbidden` class must survive the same trick.
  assert.ok(!render(`<iframe alt="<br>" srcdoc="{{x}}">`, { x: "<script>alert(1)</script>" }).includes("alert"));
  assert.ok(!render(`<div alt="<br>" onclick="{{x}}">t</div>`, { x: "alert(1)" }).includes("alert(1)"));
});

test("{{{raw}}} is not emitted verbatim inside an ordinary quoted attribute", () => {
  // A quoted non-URL attribute has url/unquoted/forbidden all false — identical to a
  // text position — so without an explicit inTag bit the raw was emitted unescaped
  // and could close the attribute and add a handler.
  for (const tpl of [`<div title="{{{x}}}">t</div>`, `<div class="{{{x}}}">t</div>`, `<img alt="{{{x}}}">`]) {
    const html = render(tpl, { x: '" onmouseover=alert(1) z="' });
    assert.ok(html.includes("&quot;"), `quotes must be escaped: ${html}`);
    assert.ok(!/"\s+onmouseover=/.test(html), `must not break out: ${html}`);
  }
  // …and it is still verbatim where that is the whole point: a markup position.
  assert.equal(render(`<div>{{{body}}}</div>`, { body: "<b>ok</b>" }), "<div><b>ok</b></div>");
});

test("a prefix that vanishes at render time does not vouch for the scheme", () => {
  // `{{#if p}}/p{{/if}}` contributes `/p` at PARSE time and nothing at render time
  // when p is false — so the URL check passed on `/p` + value, then emitted the value
  // alone, leaving a bare javascript: as the entire href.
  assertNoLiveScheme(render(`<a href="{{#if p}}/p{{/if}}{{u}}">t</a>`, { p: false, u: "javascript:alert(1)" }));
  assertNoLiveScheme(render(`<img src="{{#if p}}/i{{/if}}{{u}}">`, { p: false, u: "javascript:alert(1)" }));
  assertNoLiveScheme(render(`<a href="{{#each ps}}/{{p}}{{/each}}{{u}}">t</a>`, { ps: [], u: "javascript:alert(1)" }));
  // The control: when the prefix IS present the composed URL still works.
  assert.ok(render(`<a href="{{#if p}}/p{{/if}}{{u}}">t</a>`, { p: true, u: "ok" }).includes('href="/p'));
});

test("`/` separates attribute names, as it does for the HTML tokenizer", () => {
  // `<a/href="…">` is an href to a browser. Treating `/` as a name character made the
  // name `a/href`, which matched no rule — evading the URL policy and `forbidden`
  // alike. html-minifier emits exactly this shape.
  assertNoLiveScheme(render(`<a/href="{{u}}">t</a>`, { u: "javascript:alert(1)" }));
  assertNoLiveScheme(render(`<img/src="{{u}}">`, { u: "javascript:alert(1)" }));
  assertNoLiveScheme(render(`<a alt="x"/href="{{u}}">t</a>`, { u: "javascript:alert(1)" }));
  assert.ok(!render(`<div/onclick="{{x}}">t</div>`, { x: "alert(1)" }).includes("alert(1)"));
  assert.ok(!render(`<base/href="{{u}}">`, { u: "https://evil.example" }).includes("evil"));
});

test("constructs that are not markup cannot corrupt the tokenizer state", () => {
  // Each of these left the state machine stuck mid-"attribute value", so the NEXT real
  // href was swallowed as attribute text and never classified. The apostrophe case is
  // the one that matters most: an English contraction inside an HTML comment disabled
  // URL checking for the rest of the document.
  const after = `<a href="{{u}}">t</a>`;
  for (const prefix of [
    `<!-- don't -->`,
    `<!-- a" -->`,
    `<!-- <a href="x"> -->`,
    `<script>var s="<a href=\\"";</script>`,
    `<script>var s='x';</script>`,
    `<style>a[b="<"]{color:red}</style>`,
    `<title><a href="</title>`,
    `<p>don't stop</p>`,
    `<p>say "hi"</p>`,
    `<!doctype html>`,
  ]) {
    const html = render(prefix + after, { u: "javascript:alert(1)" });
    assertNoLiveScheme(html);
    assert.ok(html.includes('href="#"'), `${prefix} -> ${html}`);
  }
  // Comments must end at `-->`, not at the first `>`. These three distinguish the two:
  // a `>` inside the comment ends a naive scan early, and the markup AFTER it then
  // opens a phantom tag whose quote swallows the next real href. The IE conditional
  // comment is not a contrived shape — it appears in real-world HTML.
  for (const prefix of [
    `<!-- a > <b c=" -->`,
    `<!-- x > <i t=' -->`,
    `<!--[if IE]><a href="<![endif]-->`,
  ]) {
    const html = render(prefix + after, { u: "javascript:alert(1)" });
    assertNoLiveScheme(html);
    assert.ok(html.includes('href="#"'), `${prefix} -> ${html}`);
  }
  // A quote only opens a value directly after `=`, so a stray one cannot swallow the
  // rest of the tag.
  assertNoLiveScheme(render(`<a "x" href="{{u}}">t</a>`, { u: "javascript:alert(1)" }));
  assertNoLiveScheme(render(`<a b="1"c="2" href="{{u}}">t</a>`, { u: "javascript:alert(1)" }));
  // `<` in prose is not a tag, and must not start one.
  assert.equal(render(`<p>a < b</p>{{u}}`, { u: "x" }), "<p>a < b</p>x");
});

// ── Round 5: found with a parse5 differential oracle ─────────────────────────
// These are asserted against what a BROWSER sees, not against the output string —
// which is how they were found. The engine had disagreed with the spec tokenizer in
// six more places.

test("every spec comment terminator closes the comment", () => {
  // `-->` is not the only exit. Miss one and the tokenizer stays in comment mode
  // FOREVER — every placeholder after it reads as plain text, which disables the URL
  // policy, the forbidden set and unquoted escaping in one go. `--!>` is the
  // comment-end-bang state; `<!-->` and `<!--->` are complete comments.
  for (const open of [`<!-- hi --!>`, `<!-->`, `<!--->`]) {
    const html = render(`${open}<a href="{{u}}">t</a>`, { u: "javascript:alert(1)" });
    assertBrowserSafe(html, open);
    assert.ok(html.includes('href="#"'), `${open} -> ${html}`);
  }
  // Blast radius: with one bad terminator every other guard fell too.
  assertBrowserSafe(render(`<!-- x --!><a title="{{{t}}}">t</a>`, { t: '" onmouseover="alert(1)' }));
  assertBrowserSafe(render(`<!-- x --!><div class={{c}}>t</div>`, { c: "x onmouseover=alert(1)" }));
  assertBrowserSafe(render(`<!-- x --!><a onclick="{{h}}">t</a>`, { h: "alert(1)" }));
  assertBrowserSafe(render(`<!-- x --!><base href="{{u}}">`, { u: "https://evil.example/" }));
});

test("the character that ends tag-detection is reprocessed, not dropped", () => {
  // `<<a href=…>`: a browser reads the first `<` as text and the second as the tag
  // open. Discarding it meant the engine never entered tag mode at all.
  assertBrowserSafe(render(`<<a href="{{u}}">x</a>`, { u: "javascript:alert(1)" }));
});

test("raw-text elements are an HTML-namespace rule, not a global one", () => {
  // In SVG/MathML foreign content, `title` and `textarea` are ordinary elements whose
  // children ARE markup — so an anchor inside one is a real anchor.
  assertBrowserSafe(render(`<svg><title><a href="{{u}}">x</a></title></svg>`, { u: "javascript:alert(1)" }));
  assertBrowserSafe(render(`<svg><textarea><a href="{{u}}"></a></textarea></svg>`, { u: "javascript:alert(1)" }));
  // An ordinary SVG icon still works.
  assert.ok(render(`<svg><title>Menu</title><use xlink:href="#{{i}}"/></svg>`, { i: "ico" }).includes('"#ico"'));
});

test("a value inside <script>/<style> is a JS/CSS context, not an HTML one", () => {
  // Entities do NOT decode inside raw text, so a quoted JS string is inert — but a
  // backtick literal and an unquoted slot are not, and escapeHtml touches none of
  // ` $ { } \. Emitting nothing is a visible failure instead of silent execution.
  assertBrowserSafe(render("<script>var s=`{{u}}`</script>", { u: "${alert(1)}" }));
  assertBrowserSafe(render(`<script>var n={{u}}</script>`, { u: "alert(1)" }));
  assertBrowserSafe(render(`<style>.a{color:{{u}}}</style>`, { u: "red}body{background:url(//evil)" }));
  // A script with no placeholder is untouched.
  assert.ok(render(`<script>var a = 1 < 2;</script>`, {}).includes("1 < 2"));
});

test("a conditional block that may leave us inside a tag fails closed", () => {
  // Rewinding the tag state after a block is right for the PREFIX and wrong for the
  // MODE: a body that opens a tag leaves the browser inside one. Rewinding to "text"
  // — the least restrictive position there is — was fail-open.
  assertBrowserSafe(render(`{{#if a}}<a href="{{/if}}{{u}}">t</a>`, { a: 1, u: "javascript:alert(1)" }));
  assertBrowserSafe(render(`{{#each xs}}<a href="{{/each}}{{u}}">t</a>`, { xs: [1], u: "javascript:alert(1)" }));
  // A well-formed block still renders normally.
  assert.ok(render(`{{#if a}}<a href="{{u}}">x</a>{{/if}}`, { a: 1, u: "/ok" }).includes('href="/ok"'));
});

test("an attribute NAME that comes from data is an unknown position", () => {
  // We cannot know which attribute this is, so we cannot know which policy applies.
  assertBrowserSafe(render(`<a {{n}}="{{v}}">t</a>`, { n: "onclick", v: "alert(1)" }));
  assertBrowserSafe(render(`<a {{n}}="{{v}}">t</a>`, { n: "href", v: "javascript:alert(1)" }));
  assertBrowserSafe(render(`<a hr{{n}}ef="{{u}}">t</a>`, { n: "", u: "javascript:alert(1)" }));
});

test("the browser oracle agrees with the string assertions on the REAL templates", () => {
  // The whole shipped surface, checked the way a browser would read it.
  const manifesto = readFileSync(`${REPO_ROOT}templates/manifesto/template.html`, "utf8");
  assertBrowserSafe(
    render(manifesto, {
      title: "T", cta1: "Go", cta1Url: "javascript:alert(1)",
      cta2Url: "https://ok.example", closeCtaUrl: "javascript:alert(1)",
    }),
    "manifesto",
  );
  const menu = [{ label: "Evil", url: "javascript:alert(1)" }, { label: "Ok", url: "/posts" }];
  for (const part of ["header", "footer"]) {
    assertBrowserSafe(
      render(readFileSync(`${REPO_ROOT}templates/parts/${part}.html`, "utf8"), {
        siteName: "L", homeUrl: "/", year: 2026, menuHeader: menu, menuFooter: menu,
      }),
      part,
    );
  }
});
