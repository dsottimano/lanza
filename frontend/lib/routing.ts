// Shared post-query helpers for the public routes. Centralizes the two things
// every archive/listing page repeated by hand: the draft publish-gate and the
// "posts in this locale, newest first" query. Keeping the gate in ONE place
// means a change to the publish rule can't drift between routes.
import { getCollection, type CollectionEntry } from "astro:content";
import { splitId, localeUrl, type Locale } from "./i18n";

// Drafts are visible in dev and hidden in the production build. This is the
// single source of truth for the publish gate (was copy-pasted into ~10 routes).
export const isPublished = (data: { draft?: boolean }): boolean =>
  import.meta.env.PROD ? data.draft !== true : true;

/** Published posts (draft-gated), across all locales — for getStaticPaths. */
export function publishedPosts(): Promise<CollectionEntry<"posts">[]> {
  return getCollection("posts", ({ data }) => isPublished(data));
}

/** Published pages (draft-gated), across all locales — for getStaticPaths. */
export function publishedPages(): Promise<CollectionEntry<"pages">[]> {
  return getCollection("pages", ({ data }) => isPublished(data));
}

/**
 * Published posts in one locale, newest first. `extra` adds a further match
 * (e.g. a category/tag/author predicate) applied alongside the draft gate.
 */
export async function localePosts(
  locale: Locale,
  extra?: (data: CollectionEntry<"posts">["data"]) => boolean,
): Promise<CollectionEntry<"posts">[]> {
  const posts = await getCollection(
    "posts",
    ({ data }) => isPublished(data) && (extra ? extra(data) : true),
  );
  return posts
    .filter((p) => splitId(p.id).locale === locale)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

// Fallback nav for when a locale's CMS menu is empty: this locale's published
// pages, title-sorted, as {label,url}. Memoized per locale for the whole build
// (alternates.ts cache pattern) so every page render doesn't re-query pages.
const fallbackNavCache = new Map<Locale, Promise<{ label: string; url: string }[]>>();

export function fallbackNav(locale: Locale): Promise<{ label: string; url: string }[]> {
  let pending = fallbackNavCache.get(locale);
  if (!pending) {
    pending = publishedPages().then((pages) =>
      pages
        .map((p) => ({ p, ...splitId(p.id) }))
        .filter((x) => x.locale === locale)
        .sort((a, b) => a.p.data.title.localeCompare(b.p.data.title))
        .map(({ p, slug }) => ({ label: p.data.title, url: localeUrl(locale, `${slug}/`) })),
    );
    fallbackNavCache.set(locale, pending);
  }
  return pending;
}
