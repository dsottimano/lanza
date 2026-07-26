// The tenant's Cloudflare Pages project name, and the staging URL that follows from it.
//
// Cloudflare serves a branch at `<branch>.<project>.pages.dev`, so naming the staging
// alias only needs the project name. Three ways to learn it, in order:
//
//   1. The request host. On `<project>.pages.dev` the name is already there — free,
//      and it is ground truth for where this code is actually running.
//   2. `pagesProject` in lanza.config.json. Needed by any site whose project was NOT
//      created by the broker — `dsottimano/lanza` is one: its project is plainly
//      `lanza`, which no derivation can produce. Derivation describes how the broker
//      NAMES a project, not how every project got its name.
//   3. Derive it from owner/repo. The broker's name is a PURE FUNCTION of the two:
//      `<repo-slug>-<12 hex of sha256("owner/repo")>`. This is what makes a custom
//      domain work for an onboarded tenant: the hostname says nothing, but the repo
//      identity is right there in lanza.config.json.
//
// The authority for this algorithm is the broker (`functions/_lib/tenant-origin.ts`,
// projectNameCandidates) — it is what actually NAMES the project at onboarding. This
// is the third copy (broker, admin/src/backend/site-urls.ts, here) because all three
// are separate deployables that cannot import each other. They must change together:
// a divergence here does not fail loudly, it just points review links at a hostname
// that does not resolve.
//
// Only the FIRST candidate is derived. The broker's `-2/-3/-4` fallbacks exist so the
// create path can retry a taken name; they are never an authorization or addressing
// answer (see tenant-origin.ts for why that distinction is load-bearing).

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

/** The Pages project name for a repo. Deterministic — same input, same name, always. */
export async function pagesProjectName(owner: string, repo: string): Promise<string> {
  return `${slug(repo)}-${await repoHash(owner, repo)}`;
}

/**
 * Where the staging build of this site can be reviewed, or null if it can't be named.
 *
 * `repo` is the tenant's own identity (lanza.config.json). Without it, only a
 * `*.pages.dev` request host can be answered — which is exactly the gap that left
 * custom-domain tenants with no review URL.
 */
export async function stagingUrlFor(
  siteOrigin: string | null | undefined,
  branch: string,
  repo?: { owner?: unknown; name?: unknown; pagesProject?: unknown } | null,
): Promise<string | null> {
  let host: string | null = null;
  if (siteOrigin) {
    try {
      host = new URL(siteOrigin).hostname;
    } catch {
      host = null;
    }
  }

  // Exactly `<project>.pages.dev` — three labels. `staging.proj.pages.dev` has four
  // and must NOT round-trip into `staging.staging.proj.pages.dev`.
  if (host && host.split(".").length === 3 && host.endsWith(".pages.dev")) {
    return `https://${branch}.${host}`;
  }

  // Explicit beats derived. Validated as a Pages project name rather than trusted:
  // it lands in a hostname, and lanza.config.json is tenant-writable.
  const declared = typeof repo?.pagesProject === "string" ? repo.pagesProject.trim() : "";
  if (declared) {
    return /^[a-z0-9][a-z0-9-]{0,57}$/.test(declared)
      ? `https://${branch}.${declared}.pages.dev`
      : null;
  }

  const owner = typeof repo?.owner === "string" ? repo.owner : "";
  const name = typeof repo?.name === "string" ? repo.name : "";
  if (!owner || !name) return null;
  return `https://${branch}.${await pagesProjectName(owner, name)}.pages.dev`;
}
