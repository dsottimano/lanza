// The site's FIXED pages — hand-built marketing/index pages (agents, how-it-works,
// start, the blog) that aren't CMS content but exist at a fixed slug in every
// locale. This registry is their single source of truth: the locale routing rule
// (default locale at the root, others under /<locale>/) generates each one in every
// language with ZERO per-locale files, so flipping data/site.json restructures them
// all. The slug→component binding lives in components/FixedPage.astro.
//
// `seo` is the full PageSeo per locale — title/description today; canonical,
// ogImage, ogType, noindex and the meta overrides are already carried by that type,
// and further per-page concerns (JSON-LD, redirects, …) get added here as fields as
// testing surfaces the need. Everything a fixed page needs beyond its component is
// meant to live here, as data.
import type { Locale } from "./i18n";
import type { PageSeo } from "./seo";

export interface FixedPage {
  slug: string;
  // Layout template (frontend/lib/templates.ts). "landing" strips the site chrome.
  template?: string;
  // Per-locale SEO. Missing locales fall back to the default locale (FixedPage.astro).
  seo: Record<Locale, PageSeo>;
}

export const FIXED_PAGES: FixedPage[] = [
  {
    slug: "how-it-works",
    template: "landing",
    seo: {
      en: {
        title: "How it works",
        description:
          "The life of an edit, end to end: you ask, an agent edits your repository, GitHub stores it and Cloudflare serves it. No database, no server, no lock-in.",
      },
      es: {
        title: "Cómo funciona",
        description:
          "La vida de un cambio, de principio a fin: usted lo pide, un agente edita su repositorio, GitHub lo guarda y Cloudflare lo sirve. Sin base de datos, sin servidor, sin ataduras.",
      },
    },
  },
  {
    slug: "start",
    template: "landing",
    seo: {
      en: {
        title: "Get started",
        description:
          "Zero to a live site in about 30 minutes: sign in with GitHub, pick your address, say what you want, and publish. Free to start; a domain (~$12/yr) is the only cost.",
      },
      es: {
        title: "Empezar",
        description:
          "De cero a un sitio en vivo en unos 30 minutos: entre con GitHub, elija su dirección, diga qué quiere y publique. Gratis para empezar; un dominio (~$12/año) es el único gasto.",
      },
    },
  },
  {
    slug: "agents",
    template: "landing",
    seo: {
      en: {
        title: "For agents",
        description:
          "The contract for AI agents: how to read a Lanza site (/llms.txt + window.lanza) and how to edit one (the Git repo + schema.ts). No database, no proprietary API.",
      },
      es: {
        title: "Para agentes",
        description:
          "El contrato para agentes de IA: cómo leer un sitio Lanza (/llms.txt + window.lanza) y cómo editarlo (repositorio de Git + schema.ts). Sin base de datos, sin API propietaria.",
      },
    },
  },
  {
    slug: "posts",
    // The blog index — normal chrome (no landing template).
    seo: {
      en: { title: "Blog", description: "News, guides and notes on Lanza and the open web." },
      es: { title: "Blog", description: "Novedades, guías y notas sobre Lanza y la web abierta." },
    },
  },
];

/** The set of slugs owned by fixed pages — CMS routes exclude these to avoid clashes. */
export const FIXED_SLUGS = new Set(FIXED_PAGES.map((p) => p.slug));
