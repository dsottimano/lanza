import { defineCollection } from "astro:content";
import { z } from "astro:schema";
import { glob } from "astro/loaders";

// Localized collections (posts/pages/categories/tags) store one subfolder per
// locale, so the glob loader yields `id = "<locale>/<stem>"` (e.g. "en/about",
// "es/about"). Routing parses that via frontend/lib/i18n.ts `splitId`. Authors are
// not localized and stay flat (`id = "<stem>"`).

const seoSchema = z
  .object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    ogImage: z.string().optional(),
    canonical: z.string().optional(),
    ogType: z.enum(["website", "article"]).optional(),
    noindex: z.boolean().optional(),
    author: z.string().optional(),
  })
  .optional();

const posts = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./frontend/content/posts" }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    // Tolerate a blank value (e.g. Sveltia writes `updatedDate: ''`) — treat it
    // as "no date" rather than crashing the content build.
    updatedDate: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.date().optional(),
    ),
    // New entries (incl. everything the bot creates) default to draft and are
    // excluded from the production build until an editor flips this in the CMS.
    draft: z.boolean().default(false),
    description: z.string().optional(),
    featuredImage: z.string().optional(),
    // Taxonomy slugs referencing the categories/tags collections (CMS relation).
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    // Author slug referencing the authors collection (CMS relation).
    author: z.string().optional(),
    // Per-entry TEMPLATE — layout variant (frontend/lib/templates.ts is the
    // source of truth). Kept as a loose string so unknown/theme-supplied names
    // never fail the build; resolveTemplate() clamps them. `layout` is the
    // former name, retained read-side so pre-rename frontmatter still resolves.
    template: z.string().optional(),
    layout: z.string().optional(),
    seo: seoSchema,
  }),
});

// Page-builder blocks (Gutenberg-style). `type` is the discriminator key the
// CMS list widget writes for each block.
const blockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hero"),
    heading: z.string(),
    subheading: z.string().optional(),
    image: z.string().optional(),
    ctaText: z.string().optional(),
    ctaUrl: z.string().optional(),
  }),
  z.object({
    type: z.literal("text"),
    body: z.string(),
  }),
  z.object({
    type: z.literal("image"),
    image: z.string(),
    alt: z.string().optional(),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("gallery"),
    images: z
      .array(z.object({ image: z.string(), alt: z.string().optional() }))
      .default([]),
  }),
  z.object({
    type: z.literal("cta"),
    heading: z.string().optional(),
    text: z.string().optional(),
    buttonText: z.string(),
    buttonUrl: z.string(),
  }),
]);

const pages = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./frontend/content/pages" }),
  schema: z.object({
    title: z.string(),
    draft: z.boolean().default(false),
    description: z.string().optional(),
    featuredImage: z.string().optional(),
    // Per-entry TEMPLATE — see the posts collection above / frontend/lib/templates.ts.
    template: z.string().optional(),
    layout: z.string().optional(),
    blocks: z.array(blockSchema).default([]),
    seo: seoSchema,
  }),
});

// Taxonomy terms — one markdown file per term; the file slug IS the term slug.
const termSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
});

const authors = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./frontend/content/authors" }),
  schema: z.object({
    title: z.string(),
    bio: z.string().optional(),
    avatar: z.string().optional(),
  }),
});

const categories = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./frontend/content/categories" }),
  // Categories nest (WordPress-style); tags don't. `parent` is a category slug.
  schema: termSchema.extend({ parent: z.string().optional() }),
});

const tags = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./frontend/content/tags" }),
  schema: termSchema,
});

// ── La Perle real-estate collections (added by the laperle theme) ───────────
// Flat (non-localized): the theme ships a single Spanish content set and mirrors
// it with English UI chrome (no translated content), so `id` is the bare stem.

// Property listings — "a post with a gallery". Structured facets live in
// frontmatter; the long writeup is the HTML body (rendered with set:html).
const listings = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./frontend/content/listings" }),
  schema: z.object({
    title: z.string(),
    draft: z.boolean().default(false),
    pubDate: z.coerce.date().optional(),
    featuredImage: z.string().optional(),
    gallery: z
      .array(z.object({ image: z.string(), alt: z.string().optional() }))
      .default([]),
    listingType: z.enum(["sale", "rent", "sale_and_rent"]).default("sale"),
    listingStatus: z
      .enum(["active", "under_offer", "sold", "rented"])
      .default("active"),
    priceSale: z.number().optional(),
    priceRent: z.number().optional(),
    bedrooms: z.number().optional(),
    bathrooms: z.number().optional(),
    areaM2: z.number().optional(),
    lotM2: z.number().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    // Agent slug referencing the agents collection (CMS relation).
    agent: z.string().optional(),
    features: z.array(z.string()).default([]),
    flowTags: z.array(z.string()).default([]),
    // Region term slug referencing the regions collection (CMS relation).
    region: z.string().optional(),
    // Per-entry TEMPLATE — see the posts collection above / frontend/lib/templates.ts.
    // Loose string so unknown/theme names never fail the build; resolveTemplate()
    // clamps them. `layout` is the former key, kept read-side for old content.
    template: z.string().optional(),
    layout: z.string().optional(),
    seo: seoSchema,
  }),
});

const regions = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./frontend/content/regions" }),
  schema: termSchema,
});

const agents = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./frontend/content/agents" }),
  schema: z.object({
    title: z.string(),
    photo: z.string().optional(),
    role: z.string().optional(),
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    email: z.string().optional(),
    telegramChatId: z.string().optional(),
  }),
});

export const collections = { posts, pages, authors, categories, tags, listings, regions, agents };
