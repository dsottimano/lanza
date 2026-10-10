import { afterEach, expect, it } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import Editor from "./Editor.vue";
import { bodyContext, prepareBodyProposal, readableBodyHtml, MAX_BODY_HTML } from "./body-proposal";
const wrappers: VueWrapper[] = [];
async function open(html = "<p>Original article</p>") {
  const wrapper = mount(Editor, { props: { initialHtml: html } }); wrappers.push(wrapper); await flushPromises();
  return { wrapper, editor: wrapper.vm.editor! };
}
afterEach(() => wrappers.splice(0).forEach(w => w.unmount()));

it("normalizes with the real schema without modifying the editor; applies as one undoable transaction", async () => {
  const { editor } = await open();
  const proposal = prepareBodyProposal(editor, "body", "<h2>Research</h2><p>A <strong>careful</strong> article.</p>");
  expect(editor.getHTML()).toBe("<p>Original article</p>");
  expect(proposal.after).toContain("<strong>careful</strong>"); proposal.apply();
  expect(editor.getHTML()).toBe(proposal.after); editor.commands.undo();
  expect(editor.getHTML()).toBe("<p>Original article</p>");
});
it("selection replacements preserve untouched paragraphs and reject a changed selection", async () => {
  const { editor } = await open("<p>First paragraph</p><p>Second paragraph</p>");
  editor.commands.setTextSelection({ from: 1, to: 6 });
  expect(bodyContext(editor).selection?.text).toBe("First");
  const proposal = prepareBodyProposal(editor, "selection", "<strong>New</strong>");
  expect(proposal.after).toContain("Second paragraph"); proposal.apply();
  expect(editor.getHTML()).toContain("<strong>New</strong> paragraph");
  editor.commands.setTextSelection({ from: 1, to: 4 });
  const stale = prepareBodyProposal(editor, "selection", "Next");
  editor.commands.setTextSelection({ from: 2, to: 4 });
  expect(() => stale.apply()).toThrow("selection changed");
});
it("preserves editor-supported tables and rich cards through strict proposal parsing", async () => {
  const { editor } = await open('<div data-callout><p>One</p><p>Two</p></div><figure data-testimonial><blockquote><p>Quote one</p><p>Quote two</p></blockquote><figcaption><span class="who">Alex</span></figcaption></figure><table><tbody><tr><th><p>Topic</p></th><td><p>Evidence</p></td></tr></tbody></table>');
  const html = editor.getHTML();
  const proposal = prepareBodyProposal(editor, "body", html.replace("Evidence", "Verified evidence"));
  proposal.apply();
  expect(editor.getHTML()).toContain("Verified evidence");
  expect(editor.getHTML()).toContain("Quote two"); expect(editor.getHTML()).toContain("Alex");
  expect(editor.getHTML()).toContain("<table"); expect(editor.getHTML()).toContain("data-callout");
});
it.each([
  '<p>Safe</p><script>alert(1)</script>', '<p onclick="alert(1)">Unsafe</p>',
  '<a href="javascript:alert(1)">Unsafe</a>', '<p style="background:url(https://x.example)">Unsafe</p>',
  '<p>Safe</p><video src="/clip.mp4"></video>', '<iframe src="https://x.example"></iframe>',
  '<div data-embed data-src="javascript:alert(1)"></div>',
])("refuses unsafe or unsupported HTML without poisoning the current editor: %s", async html => {
  const { editor, wrapper } = await open();
  expect(() => prepareBodyProposal(editor, "body", html)).toThrow();
  expect(wrapper.emitted("invalid")).toBeUndefined(); expect(wrapper.vm.getHTML()).toBe("<p>Original article</p>");
});
it("refuses oversized proposals, missing selections and document changes after preparation", async () => {
  const { editor } = await open();
  expect(() => prepareBodyProposal(editor, "body", "x".repeat(MAX_BODY_HTML + 1))).toThrow("limited");
  expect(() => prepareBodyProposal(editor, "selection", "New")).toThrow("Select text");
  const proposal = prepareBodyProposal(editor, "body", "<p>Agent</p>");
  editor.commands.insertContent("Human"); expect(() => proposal.apply()).toThrow("body or selection changed");
});
it("makes review HTML inert while retaining readable prose and placeholders", () => {
  const html = readableBodyHtml('<p onclick="bad()" style="color:red">A <a href="https://example.com">source</a></p><img src="https://example.com/x" alt="Chart"><iframe src="https://example.com"></iframe><script>alert(1)</script>');
  expect(html).toContain("A <a>source [link: https://example.com]</a>"); expect(html).toContain("[Image: Chart]"); expect(html).toContain("[Embed]");
  expect(html).not.toMatch(/<script|<img|<iframe|href=|onclick=|style=|src=/);
});
