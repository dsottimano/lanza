import { describe, expect, it, vi } from "vitest";
import { editorSiteTools, type EditorSiteTools } from "./editor-site-tools";
import type { Field } from "../schema";
import manifesto from "../../../templates/manifesto/fields.json";

function fixture() {
  const data = { title: "Human title", draft: true, preset: "manifesto", slots: {
    headline: "Original heading", cards: [{ who: "Writers", body: "Keep this" }, { who: "Others" }],
  }, credential: "never return me" };
  const fields: Field[] = [{ name: "title", label: "Title", widget: "string" },
    { name: "draft", label: "Draft", widget: "boolean" },
    { name: "preset", label: "Template", widget: "preset" },
    { name: "slots", label: "Content", widget: "object", fields: manifesto.fields as Field[] }];
  const state = { revision: "session:1", ready: true, canEdit: true };
  const editor: EditorSiteTools = { data, fields: () => fields, revision: () => state.revision,
    context: () => ({ repository: "test/tenant", collection: "pages", locale: "en", path: "content/pages/en/home.md",
      selectedField: "slots.headline", dirty: true, baseSha: "base" }),
    ready: () => state.ready, canEdit: () => state.canEdit, focus: vi.fn().mockResolvedValue(true),
    pauseAutosave: vi.fn(), confirm: vi.fn().mockReturnValue(true) };
  const tools = editorSiteTools(editor);
  const call = (name: string, input: Record<string, unknown> = {}) => tools.find(tool => tool.name === name)!.execute(input);
  const propose = (input: Record<string, unknown> = {}) => call("propose_editor_change",
    { fieldPath: "slots.headline", expectedRevision: state.revision, value: "Proposed", ...input });
  return { data, fields, state, editor, tools, call, propose };
}

describe("live editor proposals", () => {
  it("returns selected unsaved text and the real declared numeric field paths without other data", async () => {
    const f = fixture();
    const result = await f.call("get_editor_context") as Record<string, unknown>;
    expect(result.selected).toEqual({ path: "slots.headline", label: "Hero headline", value: "Original heading" });
    expect(result.fields).toContainEqual({ path: "slots.cards.0.who", label: "Who it's for" });
    expect(JSON.stringify(result)).not.toContain("never return me");
    expect(JSON.stringify(result)).not.toContain("Keep this");
    expect(f.tools.find(tool => tool.name === "get_editor_context")!.annotations?.readOnlyHint).toBe(true);
  });
  it("changes only the confirmed field, pauses autosave, and leaves saving/publication separate", async () => {
    const f = fixture();
    const result = await f.propose({ fieldPath: "slots.cards.0.who", value: "Thinkers" });
    expect(f.editor.confirm).toHaveBeenCalledWith(expect.stringContaining("Current:\nWriters\n\nProposed:\nThinkers"));
    expect(f.editor.pauseAutosave).toHaveBeenCalledOnce();
    expect(f.data.slots.cards[0]).toEqual({ who: "Thinkers", body: "Keep this" });
    expect(f.data.slots.cards[1].who).toBe("Others");
    expect(result).toMatchObject({ accepted: true, saved: false, published: false });
  });
  it("a declined or unchanged proposal neither mutates data nor pauses human autosave", async () => {
    const f = fixture(); vi.mocked(f.editor.confirm!).mockReturnValue(false);
    expect(await f.propose()).toMatchObject({ changed: false });
    expect(f.data.slots.headline).toBe("Original heading");
    expect(f.editor.pauseAutosave).not.toHaveBeenCalled();
    await f.propose({ value: "Original heading" });
    expect(f.editor.confirm).toHaveBeenCalledOnce();
  });
  it("rejects a stale proposal before asking for confirmation", async () => {
    const f = fixture();
    await expect(f.propose({ expectedRevision: "older" })).rejects.toThrow("editor changed");
    expect(f.editor.confirm).not.toHaveBeenCalled();
    expect(f.data.slots.headline).toBe("Original heading");
  });
  it.each(["typing", "navigation", "access"])("rejects %s while confirmation is pending", async change => {
    const f = fixture();
    let finish!: (answer: boolean) => void;
    f.editor.confirm = () => new Promise<boolean>(resolve => { finish = resolve; });
    const tools = editorSiteTools(f.editor);
    const pending = tools.find(tool => tool.name === "propose_editor_change")!.execute({ fieldPath: "slots.headline", value: "Proposed", expectedRevision: "session:1" });
    if (change === "typing") { f.data.slots.headline = "New human text"; f.state.revision = "session:2"; }
    if (change === "navigation") f.state.ready = false;
    if (change === "access") f.state.canEdit = false;
    finish(true);
    await expect(pending).rejects.toThrow();
    expect(f.data.slots.headline).not.toBe("Proposed");
    expect(f.editor.pauseAutosave).not.toHaveBeenCalled();
  });
  it.each(["slots", "slots.cards", "slots.cards.2.who", "slots.cards.0.constructor", "__proto__.polluted", "preset", "draft", "credential", "body", "../other.md"])("refuses undeclared or structural path %s", async fieldPath => {
    const f = fixture();
    await expect(f.propose({ fieldPath })).rejects.toThrow("editable text field");
    expect(f.editor.confirm).not.toHaveBeenCalled();
  });
  it("does not honor prototype-shaped declarations or inherited values", async () => {
    const f = fixture(); f.fields.push({ name: "constructor", label: "Bad", widget: "string" });
    const context = await f.call("get_editor_context") as { fields: { path: string }[] };
    expect(context.fields.some(field => field.path === "constructor")).toBe(false);
  });
  it("refuses unknown arguments, non-text replacements and oversized values", async () => {
    const f = fixture();
    await expect(f.propose({ publish: true })).rejects.toThrow("arguments");
    await expect(f.propose({ value: {} })).rejects.toThrow("Replacement text");
    await expect(f.propose({ value: "x".repeat(20_001) })).rejects.toThrow("Replacement text");
    expect(f.editor.confirm).not.toHaveBeenCalled();
  });
  it("read-only accounts can inspect but cannot propose, and a failed load exposes no editor data", async () => {
    const f = fixture(); f.state.canEdit = false;
    expect(await f.call("get_editor_context")).toMatchObject({ canPropose: false });
    await expect(f.propose()).rejects.toThrow("cannot edit");
    f.state.ready = false;
    await expect(f.call("get_editor_context")).rejects.toThrow("entry to load");
  });
  it("focuses a declared field without changing its text", async () => {
    const f = fixture();
    expect(await f.call("focus_editor_field", { fieldPath: "slots.cards.0.who" })).toEqual({ path: "slots.cards.0.who", focused: true });
    expect(f.editor.focus).toHaveBeenCalledWith("slots.cards.0.who");
    expect(f.editor.confirm).not.toHaveBeenCalled();
  });
});
