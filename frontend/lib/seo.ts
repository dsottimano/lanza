import { getSeoDefaults } from "./site";
import { OG_LOCALE, DEFAULT_LOCALE, type Locale } from "./i18n";

export interface PageSeo {
  /** Page title; runs through the global title template. */
  title?: string;
  description?: string;
  ogImage?: string;
  /** "website" (default) or "article". */
  ogType?: "website" | "article";
  /** Override the auto-derived canonical URL. */
  canonical?: string;
  noindex?: boolean;
  /** Per-entry SEO overrides (from the `seo` frontmatter object). */
  metaTitle?: string;
  metaDescription?: string;
  author?: string;
}

export interface ResolvedSeo {
  title: string;
  description: string;
  canonical: string;
  ogImage: string; // absolute, or "" if none
  ogType: "website" | "article";
  noindex: boolean;
  siteName: string;
  locale: string;
  twitter: string;
  twitterCreator: string;
}

/** Resolve a relative path or already-absolute URL against the site origin. */
export function absUrl(url: string, siteUrl: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return new URL(url, siteUrl + "/").href;
}

/**
 * Merge per-page SEO with the editable per-locale defaults
 * (data/seo.<locale>.json). `og:locale` comes from the locale itself, not
 * the editable field, so it's always correct.
 */
export function resolveSeo(
  page: PageSeo,
  pathname: string,
  siteUrl: string,
  locale: Locale = DEFAULT_LOCALE,
): ResolvedSeo {
  const seoDefaults = getSeoDefaults(locale);
  const title = page.metaTitle || page.title;
  const ogImageRaw = page.ogImage || seoDefaults.defaultOgImage || "";
  return {
    title: title
      ? seoDefaults.titleTemplate.replace("%s", title)
      : seoDefaults.defaultTitle,
    description:
      page.metaDescription || page.description || seoDefaults.defaultDescription,
    canonical: page.canonical || absUrl(pathname, siteUrl),
    ogImage: ogImageRaw ? absUrl(ogImageRaw, siteUrl) : "",
    ogType: page.ogType || "website",
    noindex: page.noindex ?? false,
    siteName: seoDefaults.siteName,
    locale: OG_LOCALE[locale],
    twitter: seoDefaults.twitter || "",
    twitterCreator: seoDefaults.twitterCreator || "",
  };
}
