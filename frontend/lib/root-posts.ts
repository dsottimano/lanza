// Posts served at the site root (posts `route.base: ""`, functions/_lib/post-route.mjs).
//
// They share the URL space of the root catch-alls ([...slug].astro and
// [locale]/[...slug].astro), so those routes emit them next to pages and fixed pages.
// Astro would not reliably refuse two entries claiming one URL, so every collision
// fails the build here, with the files named, before any page is written.
import type { CollectionEntry } from "astro:content";
import schema from "/data/schema.json";
import { rootPostCollisions } from "../../functions/_lib/post-route.mjs";
import { splitEntries, type TaggedEntry } from "./paths";
import { publishedPosts } from "./routing";
import { POSTS_BASE } from "./public-urls";
import { LOCALES, type Locale } from "./i18n";

type Post = CollectionEntry<"posts">;
type Page = CollectionEntry<"pages">;

// Custom content types own their route base in every locale.
const ROUTES = (schema as Array<{ name?: string; kind?: string; route?: { base?: unknown } }>)
  .filter((c) => c.kind === "folder" && c.name !== "posts" && typeof c.route?.base === "string")
  .map((c) => ({ name: String(c.name), base: String(c.route!.base) }));

/**
 * Published posts to emit at `/<slug>/` (locale === null: the default locale) or
 * `/<locale>/<slug>/`, or [] when posts keep their /posts/ prefix.
 *
 * @param pages  every page in the same URL space, drafts included (pages own their URLs)
 * @param fixed  fixed-page slugs emitted in the same URL space
 */
export async function rootPosts(
  locale: Locale | null,
  pages: TaggedEntry<Page>[],
  fixed: string[],
): Promise<TaggedEntry<Post>[]> {
  if (POSTS_BASE !== "") return [];
  const { root, localized } = splitEntries(await publishedPosts());
  const posts = locale === null ? root : localized.filter((p) => p.locale === locale);
  const errors = rootPostCollisions({
    posts: posts.map(({ entry, slug }) => ({ id: entry.id, slug })),
    pages: pages.map(({ entry, slug }) => ({ id: entry.id, slug })),
    fixed,
    locales: [...LOCALES],
    routes: ROUTES,
  });
  if (errors.length) {
    throw new Error(
      `Posts are served at the site root (data/schema.json posts route.base ""), but:\n- ${errors.join("\n- ")}\n` +
        `Change the post's URL in the CMS (or data/site.json urls), or the other entry's.`,
    );
  }
  return posts;
}
