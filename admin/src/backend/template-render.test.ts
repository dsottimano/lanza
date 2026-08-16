import { describe, it, expect } from "vitest";
// The CMS live preview (PreviewPane) renders templates with the SAME engine Astro
// uses at build. These guard the pieces the CMS leans on — especially {{{ raw }}},
// added so a template can place the sanitized page body ({{{ body }}}).
import { render } from "../../../frontend/lib/template-render";

describe("template-render", () => {
  it("HTML-escapes {{ var }} values", () => {
    expect(render("<p>{{x}}</p>", { x: "<b>&hi" })).toBe("<p>&lt;b&gt;&amp;hi</p>");
  });

  it("emits {{{ raw }}} values verbatim", () => {
    expect(render("<div>{{{body}}}</div>", { body: "<b>hi</b>" })).toBe("<div><b>hi</b></div>");
  });

  it("renders nothing for a missing/objecty raw value", () => {
    expect(render("a{{{body}}}b", {})).toBe("ab");
    expect(render("{{{o}}}", { o: {} })).toBe("");
  });

  it("keeps escaped and raw independent in one template", () => {
    expect(render("{{a}}|{{{a}}}", { a: "<i>" })).toBe("&lt;i&gt;|<i>");
  });

  it("still handles each/if unchanged", () => {
    expect(render("{{#each xs}}[{{v}}]{{/each}}", { xs: [{ v: "a" }, { v: "b" }] })).toBe("[a][b]");
    expect(render("{{#if on}}Y{{/if}}", { on: true })).toBe("Y");
    expect(render("{{#if on}}Y{{/if}}", { on: false })).toBe("");
  });
});

// Preview markers — the reason they exist is on this side of the fence: the CMS needs to
// map a region of the rendered preview back to the slot that produced it. They are
// opt-in and the Astro build never asks for them, so "off" must be indistinguishable
// from the engine before they existed. The adversarial cases live with the rest of the
// engine's threat model in functions/_lib/template-render.test.mjs.
describe("template-render markers", () => {
  const markers = { markers: true };

  it("changes nothing when off", () => {
    // Exact prior strings, not a render-vs-render comparison: this is the production
    // output, and two runs of a changed engine would agree with each other while both
    // being wrong.
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["<p>{{x}}</p>", { x: "<b>&hi" }, "<p>&lt;b&gt;&amp;hi</p>"],
      ["<div>{{{body}}}</div>", { body: "<b>hi</b>" }, "<div><b>hi</b></div>"],
      ["{{#each xs}}[{{v}}]{{/each}}", { xs: [{ v: "a" }, { v: "b" }] }, "[a][b]"],
      [`<a href="{{u}}">x</a>`, { u: "/about" }, `<a href="/about">x</a>`],
    ];
    for (const [tpl, data, expected] of cases) {
      expect(render(tpl, data)).toBe(expected);
      expect(render(tpl, data, {})).toBe(expected);
      expect(render(tpl, data, { markers: false })).toBe(expected);
    }
  });

  it("wraps a text slot with its field path", () => {
    expect(render("<p>{{x}}</p>", { x: "hi" }, markers)).toBe('<p><span data-lanza-field="x">hi</span></p>');
    expect(render("<p>{{a.b}}</p>", { a: { b: "hi" } }, markers)).toBe('<p><span data-lanza-field="a.b">hi</span></p>');
  });

  it("qualifies an {{#each}} slot with the item index", () => {
    expect(render("{{#each xs}}<li>{{v}}</li>{{/each}}", { xs: [{ v: "a" }, { v: "b" }] }, markers)).toBe(
      '<li><span data-lanza-field="xs.0.v">a</span></li><li><span data-lanza-field="xs.1.v">b</span></li>',
    );
  });

  it("leaves attribute and raw-text slots alone", () => {
    // A `<span>` inside a tag would break the tag, and inside <title>/<script> it is
    // literal text a browser shows rather than an element.
    for (const tpl of [`<a href="{{x}}">go</a>`, `<div title="{{x}}">t</div>`, "<title>{{x}}</title>"]) {
      expect(render(tpl, { x: "/v" }, markers)).toBe(render(tpl, { x: "/v" }));
    }
    // {{{ raw }}} is emitted verbatim, so a `</span>` inside it would close the wrapper —
    // the page body is never marked.
    expect(render("<div>{{{body}}}</div>", { body: "<b>hi</b>" }, markers)).toBe("<div><b>hi</b></div>");
  });

  it("keeps escaping unchanged, so a value cannot close its own marker", () => {
    expect(render("<p>{{x}}</p>", { x: "</span><img src=x>" }, markers)).toBe(
      '<p><span data-lanza-field="x">&lt;/span&gt;&lt;img src=x&gt;</span></p>',
    );
  });
});
