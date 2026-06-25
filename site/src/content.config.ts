import { defineCollection } from "astro:content";
import { z } from "astro:schema";
import { glob } from "astro/loaders";

const seoSchema = z
  .object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    ogImage: z.string().optional(),
  })
  .optional();

const posts = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    // New entries (incl. everything the bot creates) default to draft and are
    // excluded from the production build until an editor flips this in the CMS.
    draft: z.boolean().default(false),
    description: z.string().optional(),
    seo: seoSchema,
  }),
});

export const collections = { posts };
