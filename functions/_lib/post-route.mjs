// Where the built-in Posts collection is served, and which tenant template renders it.
//
// Posts used to be hardwired to /posts/<slug>/ and to the plain PostArticle layout, so a
// site whose articles live at the root (a migrated WordPress blog, where the URLs are
// the SEO asset) had to store them as Pages. The posts collection now opts in through
// the same `route` block a custom content type uses, in data/schema.json:
//
//   { "name": "posts", ..., "route": { "base": "", "template": "article" } }
//
//   base      "posts" (the default) → /posts/<slug>/ and /<locale>/posts/<slug>/
//             ""                    → /<slug>/ and /<locale>/<slug>/ (the site root)
//   template  optional. templates/<name>/ renders each post, with the post's
//             FRONTMATTER as its scope — the "detail" position, exactly like a routed
//             collection (frontend/lib/collection-routes.ts detailScope).
//
// No `list`: the posts archive stays the built-in /posts/ page (or a CMS page with a
// listing). No other base: every place that builds a post URL would need a new
// prefix, and the two supported shapes cover the real need.
//
// ONE rule, read by gen-routes.mjs (the build gate), gen-redirects.mjs (301s for the
// old /posts/ addresses), the site-system checker (CLI + MCP), frontend/lib/public-urls.ts
// (every post link the site prints) and the CMS (admin/src/backend/site-urls.ts,
// url-changes.ts). schema.json and site.json are UNTRUSTED here as everywhere else.
//
// Lives under functions/ so the checker can use it: no node builtins, no dependencies,
// no import attributes (Cloudflare bundles this directory with an older esbuild). It
// imports nothing, because site-system.mjs imports it.

export const POSTS_DEFAULT_BASE = "posts";

/** One lowercase kebab-case URL segment. MIRROR of site-system.mjs ROUTE_SEGMENT. */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The posts collection's route, validated. Never throws: callers decide whether an
 * error dies (gen-routes), becomes a checker problem, or a 400 (MCP). On any error
 * the DEFAULT route is returned, so a caller that ignores errors keeps today's URLs.
 *
 * @param {unknown} schema parsed data/schema.json
 * @returns {{ base: "posts" | "", template: string | null, errors: string[] }}
 */
export function postsRoute(schema) {
  const fallback = { base: POSTS_DEFAULT_BASE, template: null };
  const posts = Array.isArray(schema)
    ? schema.find((c) => c && typeof c === "object" && c.kind === "folder" && c.name === "posts")
    : undefined;
  const route = posts ? posts.route : undefined;
  if (route === undefined || route === null) return { ...fallback, errors: [] };
  return { ...fallback, ...validate(route) };
}

function validate(route) {
  const at = 'collection "posts"';
  if (typeof route !== "object" || Array.isArray(route)) {
    return { errors: [`${at} route must be an object like { "base": "", "template": "article" }.`] };
  }
  const errors = [];
  for (const key of Object.keys(route)) {
    if (key === "list") {
      errors.push(`${at} cannot declare route.list: the posts archive is the built-in /posts/ page (or a CMS page with a listing).`);
    } else if (key !== "base" && key !== "template") {
      errors.push(`${at} route has unknown key ${JSON.stringify(key)}; only "base" and "template" are supported.`);
    }
  }
  const base = route.base === undefined ? POSTS_DEFAULT_BASE : route.base;
  if (base !== POSTS_DEFAULT_BASE && base !== "") {
    errors.push(
      `${at} has route.base ${JSON.stringify(route.base)}: posts live at "posts" (/posts/<slug>/) or "" (the site root, /<slug>/).`,
    );
  }
  let template = null;
  if (route.template !== undefined) {
    if (typeof route.template !== "string" || !SEGMENT.test(route.template)) {
      errors.push(`${at} has route.template ${JSON.stringify(route.template)}: must be lowercase kebab-case.`);
    } else template = route.template;
  }
  return errors.length ? { errors } : { base, template, errors };
}

/**
 * First URL segments a root-level post can never take: every site-system.mjs
 * RESERVED_ROUTE_BASES name (a test pins the superset), the system routes, and the
 * public/ folders a page slug is already refused (admin/src/backend/url-changes.ts). Locale codes
 * and content-type bases are site data and are passed in.
 */
export const ROOT_RESERVED_SLUGS = new Set([
  POSTS_DEFAULT_BASE,
  "author",
  "category",
  "tag",
  "admin",
  "api",
  "images",
  "_astro",
  "404",
  "style-preview",
  "assets",
  "fonts",
  "brand",
  "favicon",
  "social",
]);

/**
 * Every reason a set of root-level post URLs cannot be built. Empty means safe.
 *
 * Called once per URL space: the default locale's root, and each other locale's
 * /<locale>/ prefix. A collision is not resolved by route priority, it is an error —
 * one URL silently serving the other entry is exactly the failure to prevent.
 *
 * @param {object} input
 * @param {{ id: string, slug: string }[]} input.posts  public slug per post
 * @param {{ id: string, slug: string }[]} input.pages  public slug per page (drafts included: pages own their URLs)
 * @param {string[]} [input.fixed]       built-in fallback pages emitted in this space
 * @param {string[]} [input.locales]     enabled locale codes (URL prefixes)
 * @param {{ name: string, base: string }[]} [input.routes]  custom collection route bases
 * @returns {string[]}
 */
export function rootPostCollisions({ posts, pages, fixed = [], locales = [], routes = [] }) {
  const errors = [];
  const pageBySlug = new Map(pages.map((p) => [p.slug, p.id]));
  const routeByBase = new Map(routes.map((r) => [r.base, r.name]));
  const seen = new Map();
  for (const { id, slug } of posts) {
    const where = `post "${id}" would be served at /${slug}/`;
    if (typeof slug !== "string" || !SEGMENT.test(slug)) {
      errors.push(`post "${id}" has public slug ${JSON.stringify(slug)}: a root-level post URL must be one lowercase kebab-case segment.`);
    } else if (ROOT_RESERVED_SLUGS.has(slug) || fixed.includes(slug)) {
      errors.push(`${where}, which is reserved by a built-in route.`);
    } else if (locales.includes(slug)) {
      errors.push(`${where}, which is the "${slug}" language prefix.`);
    } else if (routeByBase.has(slug)) {
      errors.push(`${where}, which belongs to the "${routeByBase.get(slug)}" content type.`);
    } else if (pageBySlug.has(slug)) {
      errors.push(`${where}, which page "${pageBySlug.get(slug)}" already uses.`);
    } else if (seen.has(slug)) {
      errors.push(`${where}, which post "${seen.get(slug)}" already uses.`);
    }
    seen.set(slug, seen.get(slug) ?? id);
  }
  return errors;
}

/**
 * Cloudflare _redirects lines that send the old /posts/ addresses to the root once
 * posts move there. Only one-segment placeholders, so /posts/ itself (the archive)
 * still serves. Locale codes come from site.json and are validated before they reach
 * a routing file.
 *
 * @param {string} defaultLocale
 * @param {string[]} locales enabled locale codes
 * @returns {string[]}
 */
export function rootPostRedirects(defaultLocale, locales) {
  const prefixes = [""];
  for (const code of locales) {
    if (code !== defaultLocale && typeof code === "string" && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code)) {
      prefixes.push(`/${code}`);
    }
  }
  return prefixes.flatMap((p) => [
    `${p}/${POSTS_DEFAULT_BASE}/:slug ${p}/:slug/ 301`,
    `${p}/${POSTS_DEFAULT_BASE}/:slug/ ${p}/:slug/ 301`,
  ]);
}
