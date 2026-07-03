import type { Editor, Range } from "@tiptap/core";
import { GitHubClient, GitHubError } from "./github";
import type { SlashItem } from "../editor/extensions/slash";

// Reusable "My blocks": named HTML snippets the user composes in BlocksView and
// drops into any post/page from the slash menu. Stored shared (not localized) at
// frontend/data/blocks.json as { "blocks": [{ id, name, html }] }; a 404 on first
// load means the file doesn't exist yet → empty list.
export const BLOCKS_PATH = "frontend/data/blocks.json";

export interface Block {
  id: string;
  name: string;
  html: string;
}

export interface LoadedBlocks {
  blocks: Block[];
  sha?: string;
}

function coerceBlocks(v: unknown): Block[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (b): b is Block =>
        !!b &&
        typeof b === "object" &&
        typeof (b as Block).id === "string" &&
        typeof (b as Block).name === "string" &&
        typeof (b as Block).html === "string",
    )
    .map((b) => ({ id: b.id, name: b.name, html: b.html }));
}

export async function loadBlocks(client: GitHubClient): Promise<LoadedBlocks> {
  try {
    const { data, sha } = await client.loadJson(BLOCKS_PATH);
    return { blocks: coerceBlocks(data.blocks), sha };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return { blocks: [] };
    throw e;
  }
}

export function saveBlocks(
  client: GitHubClient,
  blocks: Block[],
  sha?: string,
): Promise<string> {
  return client.saveJson(BLOCKS_PATH, { blocks }, `lanza: update ${BLOCKS_PATH}`, sha);
}

// Turn saved blocks into slash-menu entries (a "My blocks" group). Choosing one
// inserts its stored HTML at the cursor; the editor re-parses it into nodes.
export function blockSlashItems(blocks: Block[]): SlashItem[] {
  return blocks.map((b) => ({
    title: b.name || "Untitled block",
    icon: "🧩",
    hint: "My block",
    keywords: ["block", ...(b.name ? [b.name.toLowerCase()] : [])],
    group: "My blocks",
    command: ({ editor, range }: { editor: Editor; range: Range }) =>
      editor.chain().focus().deleteRange(range).insertContent(b.html).run(),
  }));
}
