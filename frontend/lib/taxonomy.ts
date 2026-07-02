// Resolve a post's bare category/tag slugs (e.g. "web-development") to their
// display titles ("Web Development"). Posts store bare stems; the term title
// lives in the categories/tags collection for that locale.
import { getCollection, type CollectionEntry } from "astro:content";
import { splitId, type Locale } from "./i18n";

type TermCollection = "categories" | "tags";

// Per-collection map `"<locale>/<slug>" → title`, built once per collection and
// memoized for the whole build (alternates.ts cache pattern) so a post render is
// never one getCollection per page. The cached value is the in-flight promise so
// concurrent callers share one pass.
const titleCache = new Map<TermCollection, Promise<Map<string, string>>>();

function termTitles(collection: TermCollection): Promise<Map<string, string>> {
  let pending = titleCache.get(collection);
  if (!pending) {
    pending = getCollection(collection).then((entries) => {
      const map = new Map<string, string>();
      for (const e of entries) {
        const { locale, slug } = splitId(e.id);
        map.set(`${locale}/${slug}`, e.data.title);
      }
      return map;
    });
    titleCache.set(collection, pending);
  }
  return pending;
}

/** Resolve `slugs` to `{ slug, title }`, falling back to the slug if unresolved. */
export async function resolveTerms(
  collection: TermCollection,
  locale: Locale,
  slugs: string[],
): Promise<{ slug: string; title: string }[]> {
  const titles = await termTitles(collection);
  return slugs.map((slug) => ({ slug, title: titles.get(`${locale}/${slug}`) ?? slug }));
}

// Categories nest (WordPress-style). Built once for the whole build (not per page
// render, which the category routes used to do) and reused across locales.
let allCategoriesCache: Promise<{ entry: CollectionEntry<"categories">; locale: Locale; slug: string }[]> | undefined;

function allCategories() {
  if (!allCategoriesCache) {
    allCategoriesCache = getCollection("categories").then((all) =>
      all.map((entry) => ({ entry, ...splitId(entry.id) })),
    );
  }
  return allCategoriesCache;
}

export interface CategoryHierarchy {
  parent?: { slug: string; title: string };
  children: { slug: string; title: string }[];
}

/** Breadcrumb parent (if any) and title-sorted children for a category, in-locale. */
export async function categoryHierarchy(
  locale: Locale,
  stem: string,
  parentSlug?: string,
): Promise<CategoryHierarchy> {
  const cats = (await allCategories()).filter((c) => c.locale === locale);
  const parent = parentSlug ? cats.find((c) => c.slug === parentSlug) : undefined;
  const children = cats
    .filter((c) => c.entry.data.parent === stem)
    .sort((a, b) => a.entry.data.title.localeCompare(b.entry.data.title))
    .map((c) => ({ slug: c.slug, title: c.entry.data.title }));
  return {
    parent: parent ? { slug: parent.slug, title: parent.entry.data.title } : undefined,
    children,
  };
}
