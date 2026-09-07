// Public addresses are independent of filenames, which remain translation IDs.
import site from "/data/site.json";
import { localeUrl, splitId } from "./i18n";

export function publicSlug(collection: string, stem: string, locale: string): string {
  const urls = (site as { urls?: Record<string, string> }).urls;
  return urls?.[`${collection}/${locale}/${stem}`] ?? (collection === "pages" && stem === "home" ? "" : stem);
}

export function contentUrl(collection: string, id: string, prefix: string): string {
  const { locale, slug: stem } = splitId(id);
  const slug = publicSlug(collection, stem, locale);
  return localeUrl(locale, `${prefix ? prefix + "/" : ""}${slug ? slug + "/" : ""}`);
}
