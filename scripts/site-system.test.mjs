// The site-system checker, pinned two ways:
//
//  1. It must not cry wolf. The REAL manifesto template + the REAL parts must come
//     back clean, because a checker with false positives gets switched off.
//  2. It must agree with the ENGINE. For each failure it reports, the same template
//     is rendered through frontend/lib/template-render.ts and asserted to actually
//     misbehave (empty output, dropped tail). A checker that disagrees with the
//     engine either blesses a broken page or blocks a working one — both worse than
//     no checker at all.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  checkTemplate,
  checkPart,
  checkFieldsJson,
  parseTemplate,
  shapeOfFields,
  CHECKS,
  checkTemplateSafety,
  UNTRUSTED_AUTHOR_CODES,
  POSITIONS,
  WIDGETS,
  siteSystemContract,
} from "../functions/_lib/site-system.mjs";
import { render } from "../frontend/lib/template-render.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

const errors = (ps) => ps.filter((p) => p.level === "error");
const codes = (ps) => ps.map((p) => p.code);

describe("no false positives on the real site", () => {
  test("the manifesto template is clean", () => {
    const problems = checkTemplate({
      name: "manifesto",
      html: read("templates/manifesto/template.html"),
      fields: readJson("templates/manifesto/fields.json"),
    });
    assert.deepEqual(problems, [], `real template reported: ${JSON.stringify(problems, null, 2)}`);
  });

  for (const part of ["header", "footer"]) {
    test(`the ${part} part is clean`, () => {
      const problems = checkPart(part, read(`templates/parts/${part}.html`));
      assert.deepEqual(problems, [], `real part reported: ${JSON.stringify(problems, null, 2)}`);
    });
  }
});

describe("scope resolution mirrors the engine", () => {
  // The manifesto uses {{ body }} and {{ cta }} INSIDE {{#each}} blocks, where they
  // are an item's own fields — a flat name check would call both undeclared. This is
  // the case that makes the checker non-trivial, so it is pinned directly.
  const html = `{{#each steps}}<p>{{ body }}</p>{{/each}}`;
  const fields = {
    name: "t",
    fields: [{ name: "steps", label: "Steps", widget: "list", fields: [{ name: "body", label: "Body", widget: "text" }] }],
  };

  test("an item field is not reported as undeclared", () => {
    assert.deepEqual(checkTemplate({ name: "t", html, fields }), []);
  });

  test("and the engine really does resolve it", () => {
    const out = render(html, { steps: [{ body: "hello" }] });
    assert.match(out, /hello/);
  });

  test("an outer slot still resolves from inside a loop (innermost-out)", () => {
    const t = `{{#each steps}}<p>{{ siteTag }}</p>{{/each}}`;
    const f = {
      name: "t",
      fields: [
        { name: "siteTag", label: "Tag", widget: "string" },
        { name: "steps", label: "Steps", widget: "list", fields: [{ name: "x", label: "X", widget: "string" }] },
      ],
    };
    assert.deepEqual(errors(checkTemplate({ name: "t", html: t, fields: f })), []);
    assert.match(render(t, { siteTag: "OUTER", steps: [{ x: "1" }] }), /OUTER/);
  });
});

describe("catches what silently renders wrong", () => {
  test("a misspelled placeholder is an error, and the engine renders it empty", () => {
    const html = `<h1>{{ headlne }}</h1>`;
    const fields = { name: "t", fields: [{ name: "headline", label: "Headline", widget: "string" }] };
    const problems = checkTemplate({ name: "t", html, fields });
    assert.ok(codes(problems).includes("undeclared-slot"));
    // The engine's behaviour is exactly why this must be caught statically:
    assert.equal(render(html, { headline: "Real headline" }), "<h1></h1>");
  });

  test("{{#each}} over a scalar is an error, and the engine renders nothing", () => {
    const html = `{{#each tags}}<li>{{ label }}</li>{{/each}}`;
    const fields = { name: "t", fields: [{ name: "tags", label: "Tags", widget: "string" }] };
    assert.ok(codes(checkTemplate({ name: "t", html, fields })).includes("each-over-scalar"));
    assert.equal(render(html, { tags: "a,b" }), "");
  });

  test("an unclosed block is an error, and the engine drops the rest of the page", () => {
    const html = `<p>before</p>{{#if flag}}<p>inside</p><footer>after</footer>`;
    const fields = { name: "t", fields: [{ name: "flag", label: "Flag", widget: "boolean" }] };
    assert.ok(codes(checkTemplate({ name: "t", html, fields })).includes("unclosed-block"));
    const out = render(html, { flag: false });
    assert.match(out, /before/);
    assert.doesNotMatch(out, /after/, "the tail really is swallowed");
  });

  test("a loop variable outside a loop is an error", () => {
    const problems = checkTemplate({ name: "t", html: `<p>{{ @number }}</p>`, fields: { name: "t", fields: [] } });
    assert.ok(codes(problems).includes("loop-var-outside-each"));
  });

  test("{{ @index }} inside a loop is fine", () => {
    const fields = { name: "t", fields: [{ name: "rows", label: "Rows", widget: "list", fields: [{ name: "v", label: "V", widget: "string" }] }] };
    assert.deepEqual(errors(checkTemplate({ name: "t", html: `{{#each rows}}{{ @index }}{{ v }}{{/each}}`, fields })), []);
  });

  test("a stray close tag is an error", () => {
    assert.ok(codes(checkTemplate({ name: "t", html: `<p>x</p>{{/each}}`, fields: { name: "t", fields: [] } })).includes("stray-close"));
  });
});

describe("the body slot", () => {
  test("{{{ body }}} without body:true is an error", () => {
    const problems = checkTemplate({ name: "t", html: `<article>{{{ body }}}</article>`, fields: { name: "t", body: false, fields: [] } });
    assert.ok(codes(problems).includes("body-used-undeclared"));
  });

  test("body:true without {{{ body }}} is a warning", () => {
    const problems = checkTemplate({ name: "t", html: `<article>nothing</article>`, fields: { name: "t", body: true, fields: [] } });
    assert.ok(codes(problems).includes("body-declared-unused"));
    assert.equal(errors(problems).length, 0, "a canvas that goes nowhere is wrong, not fatal");
  });

  test("the matched pair is clean", () => {
    assert.deepEqual(checkTemplate({ name: "t", html: `<article>{{{ body }}}</article>`, fields: { name: "t", body: true, fields: [] } }), []);
  });

  test("a triple-brace on any other slot is an error — it emits unescaped input", () => {
    const problems = checkTemplate({
      name: "t",
      html: `<div>{{{ intro }}}</div>`,
      fields: { name: "t", fields: [{ name: "intro", label: "Intro", widget: "text" }] },
    });
    assert.ok(codes(problems).includes("raw-non-body"));
  });
});

describe("dead inputs", () => {
  test("a declared field the template never uses is a warning", () => {
    const problems = checkTemplate({
      name: "t",
      html: `<h1>{{ headline }}</h1>`,
      fields: {
        name: "t",
        fields: [
          { name: "headline", label: "Headline", widget: "string" },
          { name: "subhead", label: "Subhead", widget: "string" },
        ],
      },
    });
    const unused = problems.filter((p) => p.code === "unused-field");
    assert.equal(unused.length, 1);
    assert.match(unused[0].message, /subhead/);
  });
});

describe("fields.json structure", () => {
  test("an unknown widget is an error", () => {
    assert.ok(codes(checkFieldsJson([{ name: "a", label: "A", widget: "richtext" }], "x")).includes("unknown-widget"));
  });

  test("a select with no options is an error", () => {
    assert.ok(codes(checkFieldsJson([{ name: "a", label: "A", widget: "select" }], "x")).includes("select-without-options"));
  });

  test("duplicate field names are an error", () => {
    const ps = checkFieldsJson(
      [
        { name: "a", label: "A", widget: "string" },
        { name: "a", label: "A again", widget: "string" },
      ],
      "x",
    );
    assert.ok(codes(ps).includes("duplicate-field"));
  });

  test("a folder/name mismatch is an error — a page's preset names the folder", () => {
    const problems = checkTemplate({ name: "events", html: ``, fields: { name: "event-list", fields: [] } });
    assert.ok(codes(problems).includes("template-name-mismatch"));
  });
});

describe("parts are checked against Base.astro's data, not fields.json", () => {
  test("showNav — which the docs wrongly advertise — is reported", () => {
    // docs/authoring-templates.md lists {{#if showNav}}; Base.astro supplies
    // `showSwitcher`. An agent following the doc writes a guard that is false forever.
    const problems = checkPart("header", `{{#if showNav}}<nav>x</nav>{{/if}}`);
    assert.ok(codes(problems).includes("undeclared-slot"));
  });

  test("the real part data resolves", () => {
    const html = `{{ siteName }}{{#each menuHeader}}<a href="{{ url }}">{{ label }}</a>{{/each}}`;
    assert.deepEqual(checkPart("header", html), []);
  });
});

describe("shapeOfFields", () => {
  test("a list of variants exposes the union of every variant's fields plus `type`", () => {
    const shape = shapeOfFields([
      {
        name: "blocks",
        label: "Blocks",
        widget: "list",
        types: [
          { name: "hero", label: "Hero", fields: [{ name: "heading", label: "H", widget: "string" }] },
          { name: "text", label: "Text", fields: [{ name: "body", label: "B", widget: "text" }] },
        ],
      },
    ]);
    const item = shape.children.get("blocks");
    assert.deepEqual([...item.names].sort(), ["body", "heading", "type"]);
  });
});

describe("parseTemplate", () => {
  test("reports every unclosed block", () => {
    const { unclosed } = parseTemplate(`{{#each a}}{{#if b}}`);
    assert.equal(unclosed.length, 2);
  });
});

// The registry is what /site-system.json and the MCP describe_site_system tool serve.
// If it drifts from the codes the checker actually emits, the published contract
// documents a system nobody is running — which is exactly how docs/authoring-templates.md
// came to advertise a `showNav` that never existed.
describe("the published contract matches the enforced one", () => {
  // Both call sites: problem("error", "code", …) in the checker, and the raw
  // {level, code} objects validate-site.mjs pushes for the filesystem-level checks.
  const emitted = () => {
    const found = new Set();
    for (const file of ["functions/_lib/site-system.mjs", "scripts/validate-site.mjs"]) {
      const src = read(file);
      for (const m of src.matchAll(/problem\(\s*"(?:error|warning)",\s*"([a-z-]+)"/g)) found.add(m[1]);
      for (const m of src.matchAll(/code:\s*"([a-z-]+)"/g)) found.add(m[1]);
    }
    return found;
  };

  test("every code the checker can emit is in CHECKS", () => {
    const registered = new Set(CHECKS.map((c) => c.code));
    const missing = [...emitted()].filter((c) => !registered.has(c)).sort();
    assert.deepEqual(missing, [], `emitted but undocumented in CHECKS: ${missing.join(", ")}`);
  });

  test("CHECKS documents no code the checker cannot emit", () => {
    const found = emitted();
    const stale = CHECKS.map((c) => c.code).filter((c) => !found.has(c)).sort();
    assert.deepEqual(stale, [], `documented in CHECKS but never emitted: ${stale.join(", ")}`);
  });

  test("the contract carries the real positions, widgets and codes", () => {
    const c = siteSystemContract();
    assert.deepEqual(
      c.positions.map((p) => p.id).sort(),
      [...POSITIONS].sort(),
      "positions in the contract must be the positions checkTemplate accepts",
    );
    assert.deepEqual([...c.widgets].sort(), [...WIDGETS].sort());
    assert.equal(c.checks.length, CHECKS.length);
    // Serving it means it has to survive JSON — a Set or a Map here would publish `{}`.
    assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
  });
});

// A template is raw markup emitted with `set:html` — nothing sanitizes it, unlike a post
// body. That was fine while the author was a human with repo write access. An agent
// authoring over MCP may be acting on injected input, and the origin it would get JS on
// is the one that serves /admin. These pin BOTH directions, and the second matters more:
// a safety check that fires on ordinary markup is a safety check that gets switched off.
describe("template safety", () => {
  const codesOf = (html) => [...new Set(checkTemplateSafety(html, "t").map((p) => p.code))];
  const refused = (html) => codesOf(html).some((c) => UNTRUSTED_AUTHOR_CODES.has(c));

  const REFUSE = [
    ["a script element", `<script>alert(1)</script>`, "template-executes-js"],
    ["an event handler", `<img src=x onerror=alert(1)>`, "template-executes-js"],
    ["a javascript: URL", `<a href="javascript:alert(1)">x</a>`, "template-executes-js"],
    // The scheme check has to be case-insensitive; a browser's is.
    ["a javascript: URL in mixed case", `<a HREF="JaVaScRiPt:alert(1)">x</a>`, "template-executes-js"],
    // Same-origin framing is the documented sandbox escape — see sanitize.ts.
    ["a same-origin iframe", `<iframe src="/admin/"></iframe>`, "template-embeds-document"],
    ["a script smuggled through srcdoc", `<iframe srcdoc="&lt;script&gt;x()&lt;/script&gt;"></iframe>`, "template-executes-js"],
    ["a meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.example">`, "template-redirects-visitor"],
    ["a <base> retarget", `<base href="https://evil.example/">`, "template-redirects-visitor"],
    // Two things a regex over the source would miss and a parser does not.
    ["a script inside <svg>", `<svg><script>alert(1)</script></svg>`, "template-executes-js"],
    ["a script after a bogus comment close", `<!-- --!><script>alert(1)</script>`, "template-executes-js"],
  ];

  for (const [name, html, code] of REFUSE) {
    test(`refuses ${name}`, () => {
      assert.ok(codesOf(html).includes(code), `expected ${code}, got: ${codesOf(html).join(", ") || "nothing"}`);
      assert.ok(refused(html), `${name} must be refused from an untrusted author`);
    });
  }

  // Everything a real template is MADE of. A false positive here would refuse an
  // agent's perfectly good work, or fail a human's `check:site --strict`.
  const ALLOW = [
    ["a <style> block", `<style>.card{color:red;background:url(/i.png)}</style>`],
    ["a background-image style attribute", `<div style="background:url(/img/x.png)">a</div>`],
    ["an SVG sprite reference", `<svg><use href="#icon"/></svg>`],
    ["a placeholder in an href", `<a href="{{ url }}">{{ label }}</a>`],
    ["a placeholder inside a loop", `{{#each cards}}<a href="/p/{{slug}}">{{ heading }}</a>{{/each}}`],
    ["a placeholder in an img src", `<img src="{{ image }}" alt="{{ alt }}">`],
    ["the body slot", `<article>{{{ body }}}</article>`],
    // parse5 agrees with a browser here: this is a bogus element named `scr<script`,
    // not a script, so nothing executes. A regex for `<script` would refuse it.
    ["a bogus nested tag name", `<scr<script>ipt>alert(1)</script>`],
  ];

  for (const [name, html] of ALLOW) {
    test(`allows ${name}`, () => {
      assert.deepEqual(checkTemplateSafety(html, "t"), [], `${name} must not be flagged`);
    });
  }

  test("a remote form is reported but NOT refused", () => {
    const html = `<form action="https://forms.example/x"><input name="email"></form>`;
    assert.deepEqual(codesOf(html), ["template-loads-remote"]);
    assert.equal(refused(html), false, "a contact form posting to a form service is ordinary");
  });

  test("a relative URL is reported but NOT refused", () => {
    // It cannot reach code or another origin, so refusing it would be a lie about
    // why. It is still reported, because a page at /services/x/ resolves `about`
    // against its OWN directory and nothing else in the system notices the dead link.
    const html = `<a href="about">x</a><img src="images/hero.jpg">`;
    assert.deepEqual(codesOf(html), ["template-relative-url"]);
    assert.equal(refused(html), false);
  });

  test("a protocol-relative URL is still refused", () => {
    // `//host/x` is not relative — it inherits the scheme and reaches another origin.
    assert.ok(refused(`<img src="//evil.example/x.png">`));
  });

  test("a construct hidden inside <template> is refused", () => {
    // parse5 hangs a <template>'s children off `content`, not childNodes, so a walk
    // that follows only childNodes saw an EMPTY element and passed this.
    assert.ok(refused(`<template><script>alert(1)</script></template>`));
    assert.ok(refused(`<template><img src=x onerror=alert(1)></template>`));
  });

  test("a placeholder cannot launder a scheme", () => {
    // The inert substitution must not make `javascript:` look safe.
    assert.ok(refused(`<a href="javascript:{{ x }}">go</a>`));
  });

  test("every refusal code is a code the registry documents", () => {
    const registered = new Set(CHECKS.map((c) => c.code));
    for (const c of UNTRUSTED_AUTHOR_CODES) assert.ok(registered.has(c), `${c} missing from CHECKS`);
  });
});
