import seoDefaults from "../data/seo.json";

export interface PageSeo {
  /** Page title; runs through the global title template. */
  title?: string;
  description?: string;
  ogImage?: string;
  /** Per-entry SEO overrides (from the `seo` frontmatter object). */
  metaTitle?: string;
  metaDescription?: string;
}

/** Merge per-page SEO with the editable global defaults in src/data/seo.json. */
export function buildSeo(page: PageSeo = {}) {
  const title = page.metaTitle || page.title;
  return {
    title: title
      ? seoDefaults.titleTemplate.replace("%s", title)
      : seoDefaults.defaultTitle,
    description:
      page.metaDescription || page.description || seoDefaults.defaultDescription,
    ogImage: page.ogImage || seoDefaults.defaultOgImage || "",
    siteName: seoDefaults.siteName,
    twitter: seoDefaults.twitter || "",
  };
}
