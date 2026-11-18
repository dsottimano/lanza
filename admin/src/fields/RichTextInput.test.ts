import { afterEach, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";
import FieldInput from "./FieldInput.vue";
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach(w => w.unmount()));
async function editor(modelValue: string) {
  const w = mount(RichTextInput, { attachTo: document.body, props: { modelValue, inputId: "rich" } });
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
