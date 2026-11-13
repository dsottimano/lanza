// Public addresses are independent of filenames, which remain translation IDs.
import site from "/data/site.json";
import schema from "/data/schema.json";
import { postsRoute } from "../../functions/_lib/post-route.mjs";
import { localeUrl, splitId } from "./i18n";

// Where posts live and what renders them: the posts collection's `route` block in
// data/schema.json (see functions/_lib/post-route.mjs). gen-routes.mjs already refused
// an invalid block before the build started; this throw only guards a direct `astro`
// run that skipped the generators.
const POSTS = postsRoute(schema);
if (POSTS.errors.length) throw new Error(`data/schema.json: ${POSTS.errors.join(" ")}`);

/** Path segment before a post's slug: "posts", or "" when posts are served at the root. */
export const POSTS_BASE: string = POSTS.base;
/** templates/<name>/ that renders each post, or null for the built-in post layout. */
export const POSTS_TEMPLATE: string | null = POSTS.template;

export function publicSlug(collection: string, stem: string, locale: string): string {
  const urls = (site as { urls?: Record<string, string> }).urls;
  return urls?.[`${collection}/${locale}/${stem}`] ?? (collection === "pages" && stem === "home" ? "" : stem);
}

export function contentUrl(collection: string, id: string, prefix: string): string {
  const { locale, slug: stem } = splitId(id);
  const slug = publicSlug(collection, stem, locale);
  return localeUrl(locale, `${prefix ? prefix + "/" : ""}${slug ? slug + "/" : ""}`);
}

/** A post's public URL. Every post link goes through here so it follows POSTS_BASE. */
export function postUrl(id: string): string {
  return contentUrl("posts", id, POSTS_BASE);
}
