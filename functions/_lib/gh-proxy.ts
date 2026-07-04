// Shared GitHub-proxy policy — the single source of truth imported by BOTH the
// prod Pages Function (functions/admin/api/gh/[[path]].ts) and the dev Vite
// middleware (admin/vite.config.ts). Keep it dependency-free and runtime-neutral
// (no Node or Workers globals) so it transpiles under both Cloudflare's Pages
// bundler and Vite/esbuild.

// The proxy validates REPO-RELATIVE paths (contents/…, git/…, merges, …) — the repo
// identity (owner/name) is NOT here. It lives in the tenant's committed
// lanza.config.json, read by the callers (the prod Pages Function + the dev
// middleware), which prepend `repos/<owner>/<name>/` via upstreamPath() below. So
// this module is fully tenant-agnostic and ships unchanged in @lanza/site.
//
// The CMS works on the WORKING_BRANCH (drafts) and publishes by merging it into
// BRANCH (production — the branch Astro builds from). Ref reads/writes allow both.
const BRANCH = "main"; // production / publish target (Astro builds from this)
const WORKING_BRANCH = "staging"; // CMS drafts branch
const BRANCHES = [BRANCH, WORKING_BRANCH];

// Request headers worth forwarding upstream. Everything else (cookies, CF
// headers, host, the client's own auth) is dropped — the proxy sets auth itself.
export const FORWARD_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "x-github-api-version",
  "if-none-match",
  "if-modified-since",
];

// Response headers to strip before returning to the browser: encoding/length
// ones won't survive re-serialization (the body is already decoded by fetch()),
// and the token-scope / rate-limit headers are server-internal — don't leak them.
export const STRIP_RESPONSE_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "x-oauth-scopes",
  "x-accepted-oauth-scopes",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-used",
  "x-ratelimit-resource",
];

// Method + path allowlist enforced BEFORE the token is attached and the request
// is forwarded. Only the endpoints GitHubClient (admin/src/backend/github.ts)
// actually calls are permitted; anything else is rejected. `path` may carry a
// leading slash and/or a query string — both are normalized away here.
export function isAllowed(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const p = path.replace(/[?#].*$/, "").replace(/^\/+/, "");
  // Reject dot segments outright: fetch() normalizes `..` when it parses the
  // upstream URL, so `contents/../../../orgs/x` would escape a prefix check.
  if (/(^|\/)\.\.?(\/|$)/.test(p)) return false;

  switch (m) {
    case "GET":
      return (
        p === "user" || // token validation / login (account-scoped, not repo-scoped)
        p.startsWith("contents/") || // read + list entries
        BRANCHES.some((b) => p === `git/ref/heads/${b}`) || // branch head (commitFiles / ensureWorkingBranch)
        p.startsWith("git/commits/") || // read a git-data commit (commitFiles)
        p.startsWith("git/trees/") || // read a tree, recursive (revert)
        p.startsWith("git/blobs/") || // read a blob (revert)
        p === "commits" || // list commits (theme history)
        p.startsWith("commits/") || // read a REST commit (revert)
        p.startsWith("compare/") // compare base...head (conflict detection)
      );
    case "PUT":
    case "DELETE":
      return p.startsWith("contents/"); // create / update / delete
    case "POST":
      return (
        p === "git/blobs" ||
        p === "git/trees" ||
        p === "git/commits" ||
        p === "git/refs" || // create the working branch (ensureWorkingBranch)
        p === "merges" // publish: merge working branch → production
      );
    case "PATCH":
      return BRANCHES.some((b) => p === `git/refs/heads/${b}`); // fast-forward a branch
    default:
      return false;
  }
}

// Build the api.github.com path from a repo-RELATIVE subPath + the tenant's repo
// identity. `/user` is account-scoped (not repo-scoped) so it passes through; every
// other endpoint is scoped under repos/<owner>/<name>/. Callers hold owner/name
// (from lanza.config.json), keeping the single source of the repo prefix here.
export function upstreamPath(subPath: string, owner: string, name: string): string {
  const p = subPath.replace(/^\/+/, "");
  if (p.replace(/[?#].*$/, "") === "user") return p;
  return `repos/${owner}/${name}/${p}`;
}

// Cheap CSRF guard for state-changing methods: if the browser sent an Origin, its
// host must match the request's host. An absent Origin (non-browser tooling) is
// allowed. The GitHub-OAuth auth gate already protects the route; this blocks a
// cross-site page from driving writes through an authenticated editor's session.
const WRITE_METHODS = new Set(["PUT", "POST", "PATCH", "DELETE"]);
export function crossOriginBlocked(
  method: string,
  origin: string | null,
  host: string | null,
): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  if (!origin) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // malformed Origin on a write → reject
  }
}
