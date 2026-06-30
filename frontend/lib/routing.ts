// Shared post-query helpers for the public routes. Centralizes the two things
// every archive/listing page repeated by hand: the draft publish-gate and the
// "posts in this locale, newest first" query. Keeping the gate in ONE place
// means a change to the publish rule can't drift between routes.
import { getCollection, type CollectionEntry } from "astro:content";
import { splitId, type Locale } from "./i18n";

// Drafts are visible in dev and hidden in the production build. This is the
// single source of truth for the publish gate (was copy-pasted into ~10 routes).
const isPublished = (data: { draft?: boolean }): boolean =>
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
