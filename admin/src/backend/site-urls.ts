// Where an entry can actually be viewed.
//
// The CMS writes to `staging`, so a "View" link must point at the STAGING deployment —
// a just-saved entry does not exist on the live site until Publish, and linking there
// would 404 on exactly the thing the editor just created.
//
// The Pages project name is a pure function of owner+repo, which is what makes this
// derivable at all: `<repo-slug>-<12 hex of sha256("owner/repo")>`. The authority is
// the broker (`functions/_lib/tenant-origin.ts`, projectNameCandidates) — the two
// derivations must stay in step, because a change there silently points every link
// here at a hostname that does not resolve.
import { computed, ref } from "vue";
import type { GitHubClient } from "./github";
import { REPO } from "./config";
import { site } from "./site";

// Mirrors the broker's slug()/repoHash() budget. Kept as literals rather than shared
// constants because the SPA and the broker are separate deployables.
const MAX_BASE = 42;
const HASH_HEX = 12;

function slug(repo: string): string {
  return (
    repo
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_BASE)
      .replace(/-+$/, "") || "site"
  );
}

async function repoHash(owner: string, repo: string): Promise<string> {
  const data = new TextEncoder().encode(`${owner.toLowerCase()}/${repo.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, HASH_HEX);
}

/** `https://staging.<project>.pages.dev`, or null while unresolved / underivable. */
export const stagingOrigin = ref<string | null>(null);

export const detectedLiveOrigin = ref<string | null>(null);
export const liveOrigin = computed(() => safeOrigin(site.url) ?? detectedLiveOrigin.value);

export function safeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

export async function resolveStagingOrigin(client: GitHubClient): Promise<void> {
  stagingOrigin.value = null;
  detectedLiveOrigin.value = null;
  // Read declared domains even on pages.dev, so live links use the canonical host.
  const direct = /^(?:[a-z0-9-]+\.)?([a-z0-9-]+)\.pages\.dev$/.exec(window.location.hostname);
  if (direct) {
    detectedLiveOrigin.value = `https://${direct[1]}.pages.dev`;
    stagingOrigin.value = `https://${REPO.branch}.${direct[1]}.pages.dev`;
  }
  try {
    const { data } = await client.loadJson("lanza.config.json", REPO.productionBranch);
    const domain = Array.isArray(data.domains) ? data.domains[0] : null;
    if (typeof domain === "string" && domain.trim()) {
      detectedLiveOrigin.value = safeOrigin(/^https?:\/\//i.test(domain.trim()) ? domain.trim() : `https://${domain.trim()}`) ?? detectedLiveOrigin.value;
    }
    if (direct) return;

    // Explicit `pagesProject` beats derivation: a site whose Pages project was not
    // created by the broker (dsottimano/lanza is one — its project is just `lanza`)
    // has a name no derivation can produce. Validated, not trusted; it becomes a
    // hostname and this file is tenant-writable.
    const declared = typeof data.pagesProject === "string" ? data.pagesProject.trim() : "";
    if (declared) {
      if (/^[a-z0-9][a-z0-9-]{0,57}$/.test(declared)) {
        stagingOrigin.value = `https://${REPO.branch}.${declared}.pages.dev`;
        detectedLiveOrigin.value ??= `https://${declared}.pages.dev`;
      }
      return;
    }

    const owner = typeof data.owner === "string" ? data.owner : "";
    const name = typeof data.name === "string" ? data.name : "";
    if (!owner || !name) return;
    const project = `${slug(name)}-${await repoHash(owner, name)}`;
    stagingOrigin.value = `https://${REPO.branch}.${project}.pages.dev`;
    detectedLiveOrigin.value ??= `https://${project}.pages.dev`;
  } catch {
    // Advisory chrome only — a missing View link is never worth blocking the CMS for.
    // Keep the hostname-derived fallback when the advisory config read fails.
  }
}

// Public route per collection, mirroring frontend/pages/. A collection with no public
// page (anything a tenant added in Settings → content types) returns null, and the
// caller shows no link rather than a guess that 404s.
const ROUTES: Record<string, string> = {
  posts: "/posts/",
  pages: "/",
  categories: "/category/",
  tags: "/tag/",
  authors: "/author/",
};

// THE prefix rule for the whole CMS. Non-default locales are served under a
// /<locale> prefix; the default locale sits at the root (astro-config.mjs sets
// `prefixDefaultLocale: false`, which is what frontend/lib/i18n.ts `localeUrl`
// resolves to on the build side). Anything in the admin that needs to show a public
// path goes through here — a second copy of this rule is how /es/ silently
// disappears from an editor's URL line.
function localePrefix(locale: string): string {
  return locale && locale !== site.defaultLocale ? `/${locale}` : "";
}

// The slug's own URL segment. "home" IS the locale root (frontend/pages/index.astro
// and [locale]/index.astro build it, and [...slug].astro explicitly skips it), so it
// contributes no segment — `/`, not `/home`, which does not exist.
export function publicSlug(collection: string, slugName: string, locale: string): string {
  const override = site.urls[`${collection}/${locale}/${slugName}`];
  if (typeof override === "string") return override;
  return collection === "pages" && slugName === "home" ? "" : slugName;
}

/**
 * An entry's site-relative public path, split around its slug so the editor can
 * frame an EDITABLE slug with the real path either side of it. null when the
 * collection has no public page.
 */
export function entryPathFrame(
  collection: string,
  slugName: string,
  locale: string,
): { prefix: string; suffix: string } | null {
  const route = ROUTES[collection];
  if (!route) return null;
  return {
    prefix: `${localePrefix(locale)}${route}`,
    // Entry paths end in a slash; the locale root already has one in its prefix.
    suffix: slugName ? "/" : "",
  };
}

/** An entry's site-relative public path, or null if it has no public page. */
export function entryPath(collection: string, slugName: string, locale: string): string | null {
  const segment = publicSlug(collection, slugName, locale);
  const frame = entryPathFrame(collection, segment, locale);
  if (!frame) return null;
  return `${frame.prefix}${segment}${frame.suffix}`;
}

/** Absolute staging URL for one entry, or null if it has no public page. */
export function entryUrl(collection: string, slugName: string, locale: string): string | null {
  const origin = stagingOrigin.value;
  const path = entryPath(collection, slugName, locale);
  return origin && path ? `${origin}${path}` : null;
}
