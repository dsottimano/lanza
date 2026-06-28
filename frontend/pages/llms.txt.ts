// Prerendered /llms.txt — the discovery document for visiting AI agents
// (the llms.txt convention: like robots.txt, but a content index for LLMs).
// An Astro endpoint, not a node script, so it reuses the content collections
// and the exact same draft filter as the public pages. Static + cacheable.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { splitId, localeUrl, DEFAULT_LOCALE } from "../lib/i18n";
import { getSeoDefaults } from "../lib/site";

const seoDefaults = getSeoDefaults(DEFAULT_LOCALE);

const isPublic = ({ data }: { data: { draft?: boolean } }) =>
  import.meta.env.PROD ? data.draft !== true : true;

const item = (title: string, url: string, desc?: string) =>
  `- [${title}](${url})${desc ? `: ${desc}` : ""}`;

export const GET: APIRoute = async ({ site }) => {
  const origin = (site ?? new URL("http://localhost/")).href.replace(/\/$/, "");

  const posts = (await getCollection("posts", isPublic)).sort(
    (a, b) => +b.data.pubDate - +a.data.pubDate,
  );
  const pages = (await getCollection("pages", isPublic)).sort((a, b) =>
    a.data.title.localeCompare(b.data.title),
  );

  const sections: string[] = [
    `# ${seoDefaults.siteName}`,
    ``,
    `> ${seoDefaults.defaultDescription}`,
    ``,
    `## Agent API`,
    ``,
    `This site treats AI agents as first-class visitors. Every page loads ` +
      `\`/lanza.js\`, which exposes a \`window.lanza\` object in the browser. If ` +
      `you are an agent with access to this page's JavaScript context, call ` +
      `\`window.lanza.help()\` to discover what you can read.`,
    ``,
    `Read methods: \`lanza.page\` (current-page facts), \`lanza.toc()\` ` +
      `(headings), \`lanza.content()\` (main text), \`lanza.site\` (site info).`,
  ];

  // URLs carry the locale prefix (EN at root, /es, /fr) — see frontend/lib/i18n.ts.
  if (posts.length) {
    sections.push(``, `## Posts`, ``);
    for (const p of posts) {
      const { locale, slug } = splitId(p.id);
      const url = `${origin}${localeUrl(locale, `posts/${slug}/`)}`;
      sections.push(item(p.data.title, url, p.data.description));
    }
  }

  if (pages.length) {
    sections.push(``, `## Pages`, ``);
    for (const p of pages) {
      const { locale, slug } = splitId(p.id);
      const url = `${origin}${localeUrl(locale, `${slug}/`)}`;
      sections.push(item(p.data.title, url, p.data.description));
    }
  }

  return new Response(sections.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
