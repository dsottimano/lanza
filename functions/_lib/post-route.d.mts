export const POSTS_DEFAULT_BASE: "posts";
export const ROOT_RESERVED_SLUGS: Set<string>;
export function postsRoute(schema: unknown): { base: "posts" | ""; template: string | null; errors: string[] };
export function rootPostCollisions(input: {
  posts: { id: string; slug: string }[];
  pages: { id: string; slug: string }[];
  fixed?: string[];
  locales?: string[];
  routes?: { name: string; base: string }[];
}): string[];
export function rootPostRedirects(defaultLocale: string, locales: string[]): string[];
