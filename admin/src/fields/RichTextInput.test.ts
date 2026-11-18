import { afterEach, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";
import FieldInput from "./FieldInput.vue";
import FieldForm from "./FieldForm.vue";
import { CLIENT_KEY } from "./context";
import { sanitizeRichFields } from "../../../frontend/lib/sanitize";
import { render } from "../../../frontend/lib/template-render";
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach(w => w.unmount()));
async function editor(modelValue: string, client?: unknown) {
  const w = mount(RichTextInput, { attachTo: document.body, props: { modelValue, inputId: "rich" }, global: client ? { provide: { [CLIENT_KEY as symbol]: client } } : {} });
  wrappers.push(w); await flushPromises();
  const tiptap = (w.vm as unknown as { editor: import("@tiptap/core").Editor }).editor;
  return { w, tiptap, last: () => w.emitted("update:modelValue")?.at(-1)?.[0] as string };
}
it("applies bold, italic, underline and the fixed size and font classes", async () => {
  const { w, tiptap, last } = await editor("<p>Hello world</p>");
  tiptap.commands.setTextSelection({ from: 1, to: 6 });
  for (const label of ["Bold", "Italic", "Underline"]) await w.get(`button[aria-label="${label}"]`).trigger("click");
  await w.get('select[aria-label="Text size"]').setValue("lg");
  await w.get('select[aria-label="Font"]').setValue("heading");
  const html = last();
  for (const part of ["<strong>", "<em>", "<u>", "lz-size-lg", "lz-font-heading"]) expect(html).toContain(part);
  expect(html).not.toContain("style=");
});
it("drops anything outside basic formatting when loading stored HTML", async () => {
  const { tiptap } = await editor('<h1>T</h1><p style="color:red" onclick="x()"><a href="javascript:x">L</a><span class="hero lz-size-xl">S</span><img src=x></p>');
  const html = tiptap.getHTML();
  for (const bad of ["<h1", "style=", "onclick", "<a", "<img", "hero"]) expect(html).not.toContain(bad);
  expect(html).toContain('<span class="lz-size-xl">S</span>');
});
it("is the input FieldInput renders for a richtext field", async () => {
  const w = mount(FieldInput, { attachTo: document.body, props: { field: { name: "intro", label: "Intro", widget: "richtext" }, modelValue: "<p>Hi</p>", path: "intro" } });
  wrappers.push(w); await flushPromises();
  expect(w.findComponent(RichTextInput).exists()).toBe(true);
});
it("keeps recorded agent origin through load, human edit, save, reload and public render", async () => {
  const stored = '<p><span data-lanza-origin="agent">Original words</span></p>';
  const first = await editor(stored);
  expect(first.tiptap.getHTML()).toContain('data-lanza-origin="agent"');
  first.tiptap.commands.setTextSelection(first.tiptap.state.doc.content.size - 1);
  first.tiptap.commands.insertContent(" and human ones");
  const saved = first.last();
  expect(saved).toMatch(/<span data-lanza-origin="agent"[^>]*>Original words<\/span> and human ones/);
  const reloaded = await editor(saved);
  expect(reloaded.tiptap.getHTML()).toMatch(/<span data-lanza-origin="agent"[^>]*>Original words<\/span> and human ones/);
  const scope = sanitizeRichFields({ intro: saved }, { fields: [{ name: "intro", widget: "richtext" }] });
  expect(render("<section>{{{ intro }}}</section>", scope)).toBe('<section><p><span data-lanza-origin="agent">Original words</span> and human ones</p></section>');
});
it("keeps size and font classes inside an agent span", async () => {
  const { tiptap } = await editor('<p><span data-lanza-origin="agent"><span class="lz-size-lg lz-font-heading">Big</span></span></p>');
  const html = tiptap.getHTML();
  for (const part of ['data-lanza-origin="agent"', "lz-size-lg", "lz-font-heading"]) expect(html).toContain(part);
});
it("shows the tenant's heading and body fonts inside the document only", async () => {
  const client = { loadJson: async (path: string) => path === "data/appearance.json"
    ? { data: { brand: { fonts: { heading: "playfair-display", body: "system-serif" } } }, sha: "a" } : { data: {}, sha: "x" } };
  const { w } = await editor("<p>x</p>", client); await flushPromises();
  const style = w.get(".rich-text-input__body").attributes("style") ?? "";
  expect(style).toContain("--font-heading:");
  expect(style).toContain("Playfair Display");
  expect(style).toMatch(/--font-prose:\s*Georgia/);
  expect(document.head.querySelector('link[href^="https://fonts.googleapis.com/css2?family=Playfair"]')).not.toBeNull();
  expect(document.documentElement.getAttribute("style") ?? "").not.toContain("--font-heading");
});
it("focusField puts the caret in the richtext document, not the toolbar", async () => {
  const w = mount(FieldForm, { attachTo: document.body, props: { fields: [{ name: "intro", label: "Intro", widget: "richtext" }], data: { intro: "<p>Hi</p>" }, client: { loadJson: async () => ({ data: {} }) } as never, locale: "en" } });
  wrappers.push(w); await flushPromises();
  expect(await (w.vm as unknown as { focusField: (p: string) => Promise<boolean> }).focusField("intro")).toBe(true);
  expect((document.activeElement as HTMLElement | null)?.getAttribute("contenteditable")).toBe("true");
});
