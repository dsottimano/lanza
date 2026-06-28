// Bundled help docs for the in-CMS Guide. Markdown files in this folder are
// imported raw at build time (no GitHub calls — the Guide works offline). Order
// and slug come from the `NN-name.md` filename; the title from the first heading.
const files = import.meta.glob("./*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface HelpDoc {
  slug: string;
  title: string;
  order: number;
  body: string;
}

export const HELP_DOCS: HelpDoc[] = Object.entries(files)
  .map(([path, body]) => {
    const file = path.split("/").pop()!.replace(/\.md$/, "");
    const m = file.match(/^(\d+)-(.*)$/);
    const order = m ? Number(m[1]) : 999;
    const slug = m ? m[2] : file;
    const heading = body.match(/^#\s+(.+)$/m);
    const title = heading ? heading[1].trim() : slug;
    return { slug, title, order, body };
  })
  .sort((a, b) => a.order - b.order);
