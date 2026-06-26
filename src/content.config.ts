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

const pages = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    draft: z.boolean().default(false),
    description: z.string().optional(),
    featuredImage: z.string().optional(),
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
