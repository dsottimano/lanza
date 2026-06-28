import { absUrl } from "./seo";
import { getSeoDefaults } from "./site";
import { DEFAULT_LOCALE } from "./i18n";

// Publisher identity (organization, site name) is global — take it from the
// default-locale SEO defaults.
const seoDefaults = getSeoDefaults(DEFAULT_LOCALE);

type Node = Record<string, unknown>;

/** Organization node — the site's publisher identity. */
export function organizationSchema(siteUrl: string): Node {
  const org = seoDefaults.organization;
  return {
    "@type": "Organization",
    "@id": `${siteUrl}#organization`,
    name: org.name || seoDefaults.siteName,
    url: `${siteUrl}/`,
    ...(org.logo ? { logo: absUrl(org.logo, siteUrl) } : {}),
    ...(org.sameAs && org.sameAs.length ? { sameAs: org.sameAs } : {}),
  };
}

/** WebSite node, linked to the Organization as publisher. */
export function websiteSchema(siteUrl: string): Node {
  return {
    "@type": "WebSite",
    "@id": `${siteUrl}#website`,
    url: `${siteUrl}/`,
    name: seoDefaults.siteName,
    publisher: { "@id": `${siteUrl}#organization` },
  };
}

export interface ArticleInput {
  title: string;
  description?: string;
  image?: string;
  /** ISO 8601 */
  datePublished: string;
  /** ISO 8601; defaults to datePublished */
  dateModified?: string;
  author?: string;
  /** absolute canonical URL of the article */
  url: string;
}

/** BlogPosting node, auto-derived from a post's frontmatter. */
export function articleSchema(a: ArticleInput, siteUrl: string): Node {
  return {
    "@type": "BlogPosting",
    "@id": `${a.url}#article`,
    headline: a.title,
    ...(a.description ? { description: a.description } : {}),
    ...(a.image ? { image: absUrl(a.image, siteUrl) } : {}),
    datePublished: a.datePublished,
    dateModified: a.dateModified || a.datePublished,
    author: {
      "@type": "Person",
      name: a.author || seoDefaults.organization.name || seoDefaults.siteName,
    },
    publisher: { "@id": `${siteUrl}#organization` },
    mainEntityOfPage: { "@type": "WebPage", "@id": a.url },
  };
}

/** Wrap nodes into a single schema.org @graph, dropping nullish entries. */
export function buildGraph(nodes: Array<Node | null | undefined>) {
  return {
    "@context": "https://schema.org",
    "@graph": nodes.filter((n): n is Node => Boolean(n)),
  };
}

/** JSON for a <script type="application/ld+json">, with `<` escaped to prevent breakout. */
export function jsonLdString(graph: unknown): string {
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}
