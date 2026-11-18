// Rich-text template fields: the sanitizer is the security boundary, so the cases here
// assert what survives (the fixed allowlist) and that everything else is removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRichText, sanitizeRichFields } from "../frontend/lib/sanitize.ts";
import { renderChecked, assertSanitizedSafe } from "../frontend/lib/assert-rendered-safe.ts";
import { RICH_TEXT_CLASSES, RICH_TEXT_CSS, richTextFields } from "../functions/_lib/rich-text.mjs";

test("basic formatting and the fixed size/font classes survive", () => {
  const html = '<p><strong>B</strong> <em>I</em> <u>U</u><br><span class="lz-size-lg">L</span> <span class="lz-font-heading lz-size-sm">H</span></p>';
  assert.equal(sanitizeRichText(html), html);
  for (const c of RICH_TEXT_CLASSES) assert.match(RICH_TEXT_CSS, new RegExp(`\\.${c}\\{`));
});

test("anything outside the allowlist is removed, keeping only text", () => {
  const cases = [
    ['<p style="font-size:90px;position:fixed">x</p>', "<p>x</p>"],
    ['<span class="lz-size-lg evil other">x</span>', '<span class="lz-size-lg">x</span>'],
    ['<span class="hero__title">x</span>', "<span>x</span>"],
    ['<p class="lz-size-lg">x</p>', "<p>x</p>"],
    ['<a href="javascript:alert(1)">x</a>', "x"],
    ['<img src=x onerror=alert(1)>y', "y"],
    ['<script>alert(1)</script>z', "z"],
    ['<h1>t</h1><ul><li>i</li></ul>', "ti"],
    ['<span data-lanza-origin="agent" onclick="x()">a</span>', "<span>a</span>"],
    ['<style>body{display:none}</style>q', "q"],
    ['<iframe src="https://example.com"></iframe>w', "w"],
  ];
  for (const [input, expected] of cases) assert.equal(sanitizeRichText(input), expected, input);
});

test("non-string values become empty", () => {
  for (const v of [undefined, null, 42, { a: 1 }, ["<b>x</b>"]]) assert.equal(sanitizeRichText(v), "");
});

test("only declared top-level richtext fields are sanitized and nothing else changes", () => {
  const fields = { fields: [{ name: "intro", widget: "richtext" }, { name: "title", widget: "string" }, { name: "cards", widget: "list", fields: [{ name: "x", widget: "richtext" }] }] };
  assert.deepEqual(richTextFields(fields.fields), ["intro"]);
  const data = { intro: '<p onclick="x()">Hi <script>1</script></p>', title: "<b>t</b>", cards: [{ x: "<b>k</b>" }] };
  const out = sanitizeRichFields(data, fields);
  assert.equal(out.intro, "<p>Hi </p>");
  assert.equal(out.title, data.title);
  assert.deepEqual(out.cards, data.cards);
  assert.equal(data.intro, '<p onclick="x()">Hi <script>1</script></p>', "input is not mutated");
  assert.equal(sanitizeRichFields(data, null), data);
});

test("a sanitized rich field renders verbatim through the checked engine", () => {
  const value = sanitizeRichFields({ intro: '<p><strong>Hi</strong><a href="javascript:x">y</a></p>' }, { fields: [{ name: "intro", widget: "richtext" }] }).intro;
  assertSanitizedSafe(value, "rich field");
  assert.equal(renderChecked("<section>{{{ intro }}}</section>", { intro: value }), "<section><p><strong>Hi</strong>y</p></section>");
});
