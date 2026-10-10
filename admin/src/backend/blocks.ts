import type { Editor, Range } from "@tiptap/core";
import { GitHubClient, GitHubError } from "./github";
import type { SlashItem } from "../editor/extensions/slash";

// Reusable "Saved snippets": named HTML snippets the user composes in BlocksView and
// drops into any post/page from the slash menu. Stored shared (not localized) at
// data/blocks.json as { "blocks": [{ id, name, html }] }; a 404 on first
// load means the file doesn't exist yet → empty list.
export const BLOCKS_PATH = "data/blocks.json";

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
  if (!Array.isArray(v)) throw new Error("The snippets file must contain a blocks list.");
  const ids = new Set<string>();
  for (const item of v) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim() ||
        typeof item.name !== "string" || typeof item.html !== "string" || ids.has(item.id)) {
      throw new Error("The snippets file contains an invalid or duplicate snippet. Repair it before editing to preserve all content.");
    }
    ids.add(item.id);
  }
  return v.map(b => ({ ...b }));
}

export async function loadBlocks(client: GitHubClient): Promise<LoadedBlocks> {
  try {
    const { data, sha } = await client.loadJson(BLOCKS_PATH);
    return { blocks: coerceBlocks(data?.blocks), sha };
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

// Turn saved blocks into slash-menu entries (a "Saved snippets" group). Choosing one
// inserts its stored HTML at the cursor; the editor re-parses it into nodes.
export function blockSlashItems(blocks: Block[]): SlashItem[] {
  return blocks.map((b) => ({
    title: b.name || "Untitled snippet",
    icon: "🧩",
    hint: "Saved snippet",
    keywords: ["block", ...(b.name ? [b.name.toLowerCase()] : [])],
    group: "Saved snippets",
    command: ({ editor, range }: { editor: Editor; range: Range }) =>
      editor.chain().focus().deleteRange(range).insertContent(b.html).run(),
  }));
}
