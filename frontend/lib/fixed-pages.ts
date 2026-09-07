// Built-in archive fallback for sites without a CMS blog page.
import type { Locale } from "./i18n";
import type { PageSeo } from "./seo";
export interface FixedPage { slug: string; template?: string; seo: Record<Locale, PageSeo>; }
export const FIXED_PAGES: FixedPage[] = [{ slug: "posts", seo: { en: { title: "Blog", description: "All posts." }, es: { title: "Blog", description: "Todas las entradas." } } }];
