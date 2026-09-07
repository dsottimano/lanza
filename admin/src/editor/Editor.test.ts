import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Editor from "./Editor.vue";
import { toEditorHtml } from "../backend/markdown";

async function open(html: string) {
  const w = mount(Editor, { props: { initialHtml: html } });
  await flushPromises();
  return w;
}
describe("preserving agent-written content", () => {
  it("keeps a Markdown comparison table through two editor round trips", async () => {
    const a = await open(toEditorHtml('| Option | Result |\n| --- | --- |\n| One | Good |'));
    expect(a.emitted('invalid')).toBeUndefined();
    const first = a.vm.getHTML();
    expect(first).toContain('<table'); expect(first).toContain('Good');
    const b = await open(first);
    expect(b.emitted('invalid')).toBeUndefined();
    expect(b.vm.getHTML()).toContain('Good');
    a.unmount(); b.unmount();
  });
  it("preserves multiple paragraphs inside callouts and testimonials", async () => {
    const w = await open('<div data-callout><p>One</p><p>Two</p></div><figure data-testimonial><blockquote><p>Quote one</p><p>Quote two</p></blockquote><figcaption><span class="who">Alex</span></figcaption></figure>');
    const result = w.vm.getHTML();
    const dom = new DOMParser().parseFromString(result, 'text/html');
    expect(dom.querySelector('[data-callout]')?.textContent).toBe('OneTwo');
    expect(dom.querySelector('[data-testimonial] blockquote')?.textContent).toBe('Quote oneQuote two');
    w.unmount();
  });
  it("refuses to save unsupported markup instead of silently deleting it", async () => {
    const w = await open('<p>Introduction</p><video src="/clip.mp4"></video>');
    expect(w.emitted('invalid')).toHaveLength(1);
    expect(() => w.vm.getHTML()).toThrow('cannot preserve');
    w.unmount();
  });
  it("formats Markdown containing inline HTML and autolinks", () => {
    const html = toEditorHtml('# Heading\n\nA <b>bold</b> word.\n\n<https://example.com>');
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<a href="https://example.com">');
  });
});
