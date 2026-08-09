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
import site from "/data/site.json";

// how-it-works / start / agents are LANZA'S OWN marketing pages. This module ships
// inside the lanza-site package, so without a gate every tenant's site would serve
// (and get indexed for) lanzacms.com's copy at their own domain. Only the product
// site sets `productSite: true` in data/site.json. The blog index is not in here:
// every tenant needs it.
const PRODUCT_ONLY = new Set(["how-it-works", "start", "agents", "architecture"]);

export interface FixedPage {
  slug: string;
  // Layout template (frontend/lib/templates.ts). "landing" strips the site chrome.
  template?: string;
  // Per-locale SEO. Missing locales fall back to the default locale (FixedPage.astro).
  seo: Record<Locale, PageSeo>;
}

const ALL_FIXED_PAGES: FixedPage[] = [
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
    // The deep layer under /how-it-works: same machine, stated as a wiring diagram
    // rather than a story. Kept a separate page so the narrative one stays readable
    // by someone who does not want to know what RS256 is.
    slug: "architecture",
    template: "landing",
    seo: {
      en: {
        title: "Architecture",
        description:
          "Every moving part named: what runs where, who holds which secret and for how long, how signing in actually works, and what an agent is allowed to touch.",
      },
      es: {
        title: "Arquitectura",
        description:
          "Cada pieza con su nombre: qué se ejecuta dónde, quién guarda qué secreto y por cuánto tiempo, cómo funciona de verdad el inicio de sesión y qué puede tocar un agente.",
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

// The blog index IS every tenant's, but its copy above is Lanza's own, and it
// would otherwise become their meta description. Tenants get neutral wording.
const GENERIC_POSTS_SEO: Record<Locale, PageSeo> = {
  en: { title: "Blog", description: "All posts." },
  es: { title: "Blog", description: "Todas las entradas." },
};

export const FIXED_PAGES: FixedPage[] = (site as { productSite?: boolean }).productSite
  ? ALL_FIXED_PAGES
  : ALL_FIXED_PAGES.filter((p) => !PRODUCT_ONLY.has(p.slug)).map((p) =>
      p.slug === "posts" ? { ...p, seo: GENERIC_POSTS_SEO } : p,
    );

/** The set of slugs owned by fixed pages — CMS routes exclude these to avoid clashes. */
export const FIXED_SLUGS = new Set(FIXED_PAGES.map((p) => p.slug));
