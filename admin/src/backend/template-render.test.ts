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
