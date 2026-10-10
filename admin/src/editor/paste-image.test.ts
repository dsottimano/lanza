import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Figure } from "./extensions/Figure";
import { pasteImage } from "./paste-image";

let editor: Editor;
const file = () => new File(["png"], "image.png", { type: "image/png" });
const figures = () => editor.getJSON().content!.filter(n => n.type === "figure");
function open(content = '<p>Before</p><p>After</p>') {
  editor = new Editor({ extensions: [StarterKit, Figure.extend({ addNodeView() { return null; } })], content });
  return editor;
}
beforeEach(() => vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview"));
afterEach(() => { editor?.destroy(); vi.restoreAllMocks(); });
describe("clipboard image upload", () => {
  it("inserts at the cursor and preserves later typing while an upload finishes", async () => {
    open(); editor.commands.setTextSelection(7);
    let finish!: (src: string) => void;
    const upload = vi.fn((_file: File) => new Promise<string>(r => { finish = r; }));
    const pending = pasteImage(editor, [file()], editor.view.dom, upload, vi.fn());
    expect(figures()).toHaveLength(1);
    expect(figures()[0].attrs?.pastePreview).toBe("blob:preview");
    editor.commands.setTextSelection(2); editor.commands.insertContent("Human edit");
    finish("/images/uploads/map.png"); await pending;
    expect(editor.getText()).toContain("Human edit");
    expect(figures()[0].attrs?.src).toBe("/images/uploads/map.png");
    expect(editor.getHTML()).not.toMatch(/blob:|pasteUploadId|pastePreview/);
    expect(upload.mock.calls[0]![0].name).toMatch(/^pasted-image-.+\.png$/);
  });
  it("fills a focused empty figure instead of adding another and keeps its caption", async () => {
    open('<p>Before</p><figure><img src=""><figcaption>Map caption</figcaption></figure><p>After</p>');
    const target = editor.view.dom.querySelector("figure")!;
    await pasteImage(editor, [file()], target, async () => "/images/uploads/map.png", vi.fn());
    expect(figures()).toHaveLength(1);
    expect(figures()[0].attrs?.src).toBe("/images/uploads/map.png");
    expect(editor.getHTML()).toContain("Map caption");
  });
  it("does not resurrect an image deleted during upload", async () => {
    open(); let finish!: (src: string) => void;
    const pending = pasteImage(editor, [file()], editor.view.dom, () => new Promise(r => { finish = r; }), vi.fn());
    editor.commands.setContent("<p>New writing</p>");
    finish("/images/uploads/map.png"); await pending;
    expect(figures()).toHaveLength(0); expect(editor.getText()).toBe("New writing");
  });
  it("keeps a retryable empty figure when upload fails", async () => {
    open();
    await expect(pasteImage(editor, [file()], editor.view.dom, async () => { throw new Error("Offline"); }, vi.fn())).rejects.toThrow("Offline");
    expect(figures()[0].attrs).toMatchObject({ src: null, pastePreview: null, pasteUploadId: null });
  });
  it("rejects unsupported files before altering the document or uploading", async () => {
    open(); const html = editor.getHTML(), upload = vi.fn();
    await expect(pasteImage(editor, [new File(["svg"], "x.svg", { type: "image/svg+xml" })], editor.view.dom, upload, vi.fn())).rejects.toThrow("PNG");
    expect(upload).not.toHaveBeenCalled(); expect(editor.getHTML()).toBe(html);
  });
  it("uploads multiple images in order", async () => {
    open(); let i = 0;
    await pasteImage(editor, [file(), file()], editor.view.dom, async () => `/images/${++i}.png`, vi.fn());
    expect(figures().map(n => n.attrs?.src)).toEqual(["/images/1.png", "/images/2.png"]);
  });
  it("undoes and redoes the completed paste without leaving a pending upload", async () => {
    open();
    await pasteImage(editor, [file()], editor.view.dom, async () => "/images/map.png", vi.fn());
    editor.commands.undo(); expect(figures()).toHaveLength(0);
    editor.commands.redo(); expect(figures()[0].attrs).toMatchObject({ src: "/images/map.png", pasteUploadId: null });
  });
});
