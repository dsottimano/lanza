// Prerendered /llms.txt — the discovery document for visiting AI agents
// (the llms.txt convention: like robots.txt, but a content index for LLMs).
// An Astro endpoint, not a node script, so it reuses the content collections
// and the exact same draft filter as the public pages. Static + cacheable.
import type { APIRoute } from "astro";
import { splitId, localeUrl, isLocale, DEFAULT_LOCALE } from "../lib/i18n";
import { getSeoDefaults } from "../lib/site";
import { publishedPosts, publishedPages } from "../lib/routing";
// The tenant's own content model. Typed loosely on purpose — it is per-site data,
// and every site's shape is different. See docs/site-system.md.
import schemaJson from "/data/schema.json";

const seoDefaults = getSeoDefaults(DEFAULT_LOCALE);

interface SchemaCollection {
  name?: string;
  kind?: string;
  route?: { base?: string };
  fields?: Array<{ name?: string }>;
}

// Only `folder` collections are content types with entries; `files` collections are
// singleton settings files, which are not a thing an agent authors entries into.
const contentTypes = (schemaJson as unknown as SchemaCollection[]).filter(
  (c) => c.kind === "folder" && c.name,
);

const item = (title: string, url: string, desc?: string) =>
  `- [${title}](${url})${desc ? `: ${desc}` : ""}`;

export const GET: APIRoute = async ({ site }) => {
  const origin = (site ?? new URL("http://localhost/")).href.replace(/\/$/, "");

  const posts = (await publishedPosts()).sort(
    (a, b) => +b.data.pubDate - +a.data.pubDate,
  );
  const pages = (await publishedPages()).sort((a, b) =>
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
    ``,
    // The write half. An agent that can only read this document can still tell whoever
    // sent it what shape a change would take, and where the rules are written down.
    `## How this site is built`,
    ``,
    `This is a Lanza site. Its pages are composed from templates, a content model ` +
      `and routes, and one rule holds them together: **a layer may only reference ` +
      `names the layer below it declares.** It is worth stating because the failures ` +
      `are silent: a misspelled placeholder renders as empty text and the build passes.`,
    ``,
    `The full machine-readable contract, covering the layers, what each template position ` +
      `puts in scope, the field widgets, the reserved names, and every way a site can ` +
      `be silently wrong, is at ${origin}/site-system.json.`,
    ``,
    `Content can be read and written over MCP at ${origin}/api/mcp (authenticated; ` +
      `writes land on a staging branch and are not public until published). The same ` +
      `server exposes \`describe_site_system\` and \`validate_site\`, so you can check a change ` +
      `against the contract before publishing it.`,
  ];

  if (contentTypes.length) {
    sections.push(``, `## Content types`, ``);
    for (const c of contentTypes) {
      const at = c.route?.base ? ` (at /${c.route.base}/)` : "";
      const fields = (c.fields ?? []).map((f) => f.name).filter(Boolean);
      sections.push(`- ${c.name}${at}: ${fields.length ? fields.join(", ") : "no declared fields"}`);
    }
  }

  // URLs carry the locale prefix (EN at root, /es, /fr) — see frontend/lib/i18n.ts.
  if (posts.length) {
    sections.push(``, `## Posts`, ``);
    for (const p of posts) {
      const { locale, slug } = splitId(p.id);
      if (!isLocale(locale)) continue; // skip content for disabled locales
      const url = `${origin}${localeUrl(locale, `posts/${slug}/`)}`;
      sections.push(item(p.data.title, url, p.data.description));
    }
  }

  if (pages.length) {
    sections.push(``, `## Pages`, ``);
    for (const p of pages) {
      const { locale, slug } = splitId(p.id);
      if (!isLocale(locale)) continue; // skip content for disabled locales
      const url = `${origin}${localeUrl(locale, `${slug}/`)}`;
      sections.push(item(p.data.title, url, p.data.description));
    }
  }

  return new Response(sections.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
