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
import { ref } from "vue";
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

export async function resolveStagingOrigin(client: GitHubClient): Promise<void> {
  // Fast path: on `<project>.pages.dev` the project name is already in the hostname,
  // so the common tenant costs no request. (`staging.<project>.pages.dev/admin`
  // redirects to the live CMS, so this host is never itself a staging host.)
  const direct = /^([a-z0-9-]+)\.pages\.dev$/.exec(window.location.hostname);
  if (direct) {
    stagingOrigin.value = `https://${REPO.branch}.${direct[1]}.pages.dev`;
    return;
  }

  // Custom domain: the hostname says nothing about the project, so derive it from
  // owner/repo. The SPA deliberately does not hold its own repo identity (see
  // config.ts) — but it can READ it, because the proxy prepends the tenant's repo to
  // every path, so this can only ever return OUR config.
  try {
    const { data } = await client.loadJson("lanza.config.json", REPO.productionBranch);

    // Explicit `pagesProject` beats derivation: a site whose Pages project was not
    // created by the broker (dsottimano/lanza is one — its project is just `lanza`)
    // has a name no derivation can produce. Validated, not trusted; it becomes a
    // hostname and this file is tenant-writable.
    const declared = typeof data.pagesProject === "string" ? data.pagesProject.trim() : "";
    if (declared) {
      if (/^[a-z0-9][a-z0-9-]{0,57}$/.test(declared)) {
        stagingOrigin.value = `https://${REPO.branch}.${declared}.pages.dev`;
      }
      return;
    }

    const owner = typeof data.owner === "string" ? data.owner : "";
    const name = typeof data.name === "string" ? data.name : "";
    if (!owner || !name) return;
    stagingOrigin.value = `https://${REPO.branch}.${slug(name)}-${await repoHash(owner, name)}.pages.dev`;
  } catch {
    // Advisory chrome only — a missing View link is never worth blocking the CMS for.
    stagingOrigin.value = null;
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
function urlSlug(collection: string, slugName: string): string {
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
    suffix: urlSlug(collection, slugName) ? "/" : "",
  };
}

/** An entry's site-relative public path, or null if it has no public page. */
export function entryPath(collection: string, slugName: string, locale: string): string | null {
  const frame = entryPathFrame(collection, slugName, locale);
  if (!frame) return null;
  return `${frame.prefix}${urlSlug(collection, slugName)}${frame.suffix}`;
}

/** Absolute staging URL for one entry, or null if it has no public page. */
export function entryUrl(collection: string, slugName: string, locale: string): string | null {
  const origin = stagingOrigin.value;
  const path = entryPath(collection, slugName, locale);
  return origin && path ? `${origin}${path}` : null;
}
