import { defineCollection } from "astro:content";
import { z } from "astro:schema";
import { glob } from "astro/loaders";

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
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
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
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    draft: z.boolean().default(false),
    description: z.string().optional(),
    featuredImage: z.string().optional(),
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
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/authors" }),
  schema: z.object({
    title: z.string(),
    bio: z.string().optional(),
    avatar: z.string().optional(),
  }),
});

const categories = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/categories" }),
  // Categories nest (WordPress-style); tags don't. `parent` is a category slug.
  schema: termSchema.extend({ parent: z.string().optional() }),
});

const tags = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/tags" }),
  schema: termSchema,
});

export const collections = { posts, pages, authors, categories, tags };
