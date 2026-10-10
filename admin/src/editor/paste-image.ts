import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";

const imageTypes: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };

/** Insert uploads immediately, then address their surviving nodes, never a later cursor. */
export async function pasteImage(editor: Editor, files: File[], target: Node, upload: (file: File) => Promise<string>, keepPreview: (url: string) => void): Promise<void> {
  if (files.length > 10) throw new Error("Paste up to 10 images at a time.");
  for (const file of files) {
    if (!imageTypes[file.type]) throw new Error("Paste a PNG, JPEG, GIF, WebP or AVIF image.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Each pasted image must be smaller than 20 MB.");
  }
  let emptyPosition: number | undefined;
  let selectedEmpty: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "figure" || node.attrs.src || node.attrs.pasteUploadId) return;
    const dom = editor.view.nodeDOM(pos);
    const selected = editor.state.selection.from === pos || (editor.state.selection.from > pos && editor.state.selection.to < pos + node.nodeSize);
    if (dom?.contains(target)) emptyPosition = pos;
    if (selected) selectedEmpty ??= pos;
  });
  emptyPosition ??= selectedEmpty;
  const jobs: Array<{ id: string; file: File }> = [];
  for (const original of files) {
    const id = crypto.randomUUID();
    // Clipboard filenames are often just "image.png". Unique names avoid replace prompts.
    const file = new File([original], `pasted-image-${id}.${imageTypes[original.type]}`, { type: original.type });
    const preview = URL.createObjectURL(file); keepPreview(preview);
    const attrs = { src: null, alt: "", pasteUploadId: id, pastePreview: preview };
    if (emptyPosition !== undefined) {
      const node = editor.state.doc.nodeAt(emptyPosition)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(emptyPosition, undefined, { ...node.attrs, ...attrs }));
      editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(emptyPosition + node.nodeSize))));
      emptyPosition = undefined;
    } else if (!editor.commands.insertContent({ type: "figure", attrs })) {
      throw new Error("Place the cursor in the article and paste the image again.");
    }
    jobs.push({ id, file });
  }
  let failure: unknown;
  for (const job of jobs) {
    const locate = () => {
      let found: { pos: number; attrs: Record<string, unknown> } | undefined;
      if (!editor.isDestroyed) editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "figure" && node.attrs.pasteUploadId === job.id && !node.attrs.src) found = { pos, attrs: node.attrs };
      });
      return found;
    };
    if (!locate()) continue;
    try {
      const src = await upload(job.file);
      const current = locate();
      if (current) editor.view.dispatch(editor.state.tr.setNodeMarkup(current.pos, undefined, { ...current.attrs, src, pasteUploadId: null }).setMeta("addToHistory", false));
    } catch (error) {
      failure = error;
      const current = locate();
      if (current) editor.view.dispatch(editor.state.tr.setNodeMarkup(current.pos, undefined, { ...current.attrs, pasteUploadId: null, pastePreview: null }).setMeta("addToHistory", false));
    }
  }
  if (failure) throw failure;
}
