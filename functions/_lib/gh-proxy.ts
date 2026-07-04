// Shared GitHub-proxy policy — the single source of truth imported by BOTH the
// prod Pages Function (functions/admin/api/gh/[[path]].ts) and the dev Vite
// middleware (admin/vite.config.ts). Keep it dependency-free and runtime-neutral
// (no Node or Workers globals) so it transpiles under both Cloudflare's Pages
// bundler and Vite/esbuild.

// Repo coordinates — MUST match admin/src/backend/config.ts (REPO). The proxy is
// scoped to this one repo; nothing else is reachable through it. The CMS works on
// the WORKING_BRANCH (drafts) and publishes by merging it into BRANCH (production
// — the branch Astro builds from). Ref reads/writes are allowed for both.
export const OWNER = "dsottimano";
export const NAME = "lanza";
const BRANCH = "main"; // production / publish target (Astro builds from this)
const WORKING_BRANCH = "staging"; // CMS drafts branch
const BRANCHES = [BRANCH, WORKING_BRANCH];
const REPO_PREFIX = `repos/${OWNER}/${NAME}`;

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
  const git = `${REPO_PREFIX}/git`;

  switch (m) {
    case "GET":
      return (
        p === "user" || // token validation / login
        p.startsWith(`${REPO_PREFIX}/contents/`) || // read + list entries
        BRANCHES.some((b) => p === `${git}/ref/heads/${b}`) || // branch head (commitFiles / ensureWorkingBranch)
        p.startsWith(`${git}/commits/`) || // read a git-data commit (commitFiles)
        p.startsWith(`${git}/trees/`) || // read a tree, recursive (revert)
        p.startsWith(`${git}/blobs/`) || // read a blob (revert)
        p === `${REPO_PREFIX}/commits` || // list commits (theme history)
        p.startsWith(`${REPO_PREFIX}/commits/`) || // read a REST commit (revert)
        p.startsWith(`${REPO_PREFIX}/compare/`) // compare base...head (conflict detection)
      );
    case "PUT":
    case "DELETE":
      return p.startsWith(`${REPO_PREFIX}/contents/`); // create / update / delete
    case "POST":
      return (
        p === `${git}/blobs` ||
        p === `${git}/trees` ||
        p === `${git}/commits` ||
        p === `${git}/refs` || // create the working branch (ensureWorkingBranch)
        p === `${REPO_PREFIX}/merges` // publish: merge working branch → production
      );
    case "PATCH":
      return BRANCHES.some((b) => p === `${git}/refs/heads/${b}`); // fast-forward a branch
    default:
      return false;
  }
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
