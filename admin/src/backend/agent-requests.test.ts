import { afterEach, expect, it } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import Editor from "../editor/Editor.vue";
import { captureRequestAnchor, htmlHash, newRequestId, prepareRequestReplacement } from "./agent-requests";
const wrappers: VueWrapper[] = [];
async function fixture() {
  const wrapper = mount(Editor, { props: { initialHtml: "<p>Ground moves differently.</p><p>Keep this paragraph.</p>" } });
  wrappers.push(wrapper); await flushPromises(); const editor = wrapper.vm.editor!;
  editor.commands.setTextSelection({ from: 1, to: 7 });
  return { wrapper, editor, anchor: await captureRequestAnchor(editor) };
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));
it("captures exact text, positions, surrounding context and SHA256 of the complete editor body", async () => {
  const { editor, anchor } = await fixture();
  expect(anchor).toMatchObject({ quote: "Ground", from: 1, to: 7, before: "", after: expect.stringContaining("moves differently") });
  expect(anchor.bodyHash).toBe(await htmlHash(editor.getHTML())); expect(anchor.bodyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(newRequestId()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
it("restores captured text instead of a newer selection, validates detached and keeps normal undo", async () => {
  const { editor, anchor } = await fixture(); editor.commands.setTextSelection({ from: 8, to: 13 });
  const original = editor.getHTML(); const proposal = await prepareRequestReplacement(editor, anchor, "<strong>Soil</strong>");
  expect(editor.getHTML()).toBe(original); expect(editor.state.selection.from).toBe(1);
  proposal.apply(); expect(editor.getHTML()).toContain("<strong><span data-lanza-origin=\"agent\" title=\"Agent-written text\">Soil</span></strong> moves differently.");
  expect(editor.getHTML()).toContain("Keep this paragraph."); editor.commands.undo(); expect(editor.getHTML()).toBe(original);
});
it("refuses any body change, forged selection evidence, and unsupported or active replacement HTML", async () => {
  const { editor, anchor, wrapper } = await fixture();
  await expect(prepareRequestReplacement(editor, { ...anchor, quote: "Wrong" }, "Soil")).rejects.toThrow("older article");
  await expect(prepareRequestReplacement(editor, { ...anchor, before: "Wrong" }, "Soil")).rejects.toThrow("older article");
  await expect(prepareRequestReplacement(editor, anchor, '<img src="/x.png" onerror="alert(1)">')).rejects.toThrow("active HTML");
  await expect(prepareRequestReplacement(editor, anchor, '<video src="/x.mp4"></video>')).rejects.toThrow("cannot preserve");
  expect(wrapper.emitted("invalid")).toBeUndefined();
  editor.commands.insertContentAt(editor.state.doc.content.size - 1, "Changed elsewhere");
  await expect(prepareRequestReplacement(editor, anchor, "Soil")).rejects.toThrow("older article");
});
it("refuses a document or selection changed during human review", async () => {
  const { editor, anchor } = await fixture(); const proposal = await prepareRequestReplacement(editor, anchor, "Soil");
  editor.commands.setTextSelection({ from: 8, to: 13 }); expect(() => proposal.apply()).toThrow("selection changed");
});
