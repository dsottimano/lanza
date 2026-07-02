// Shared Cloudflare-API-proxy policy — the single source of truth imported by
// BOTH the prod Pages Function (functions/admin/api/cf/[[path]].ts) and the dev
// Vite middleware (admin/vite.config.ts). Keep it dependency-free and
// runtime-neutral (no Node or Workers globals) so it transpiles under both
// Cloudflare's Pages bundler and Vite/esbuild.
//
// Mirrors functions/_lib/gh-proxy.ts: a method+path allowlist enforced BEFORE the
// token is attached, plus the same cross-origin (CSRF) guard. The CSRF guard is
// generic (no GitHub specifics), so we reuse it directly rather than copy it —
// one implementation, so the two proxies can't drift.
export { crossOriginBlocked } from "./gh-proxy";

// The client NEVER learns the real account ID or Pages project name. It sends the
// literal placeholder `self` for both — `accounts/self/...` and
// `pages/projects/self` — and the proxy substitutes the server-side values. The
// account ID is a secret (substituted AFTER the allowlist, so it never appears in
// the matched path); the project name is public and a legitimate allowlist
// parameter, so the project placeholder is resolved BEFORE the allowlist and the
// allowlist validates the real name (see isAllowed / the two substitute helpers).

// Request headers worth forwarding upstream. Everything else (cookies, CF
// headers, host, the client's own auth) is dropped — the proxy sets auth itself.
export const FORWARD_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "if-none-match",
  "if-modified-since",
];

// Response headers to strip before returning to the browser: encoding/length ones
// won't survive re-serialization (the body is already decoded by fetch()), and
// the rate-limit headers are server-internal — don't leak them.
export const STRIP_RESPONSE_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

// Collection paths, all account-scoped via the `self` placeholder. `database` is
// singular (D1) and `namespaces` is under `storage/kv` (KV) — per the CF API.
const KV = "accounts/self/storage/kv/namespaces";
const D1 = "accounts/self/d1/database";
const R2 = "accounts/self/r2/buckets";

// Method + path allowlist enforced BEFORE the token is attached and the request
// is forwarded. Only the endpoints CloudflareClient (admin/src/backend/cloudflare.ts)
// actually calls are permitted; anything else is rejected. `path` may carry a
// leading slash and/or a query string — both are normalized away here. The
// account segment is still the literal `self` at this point (substituted later),
// so any concrete account id (e.g. `accounts/1234/...`) fails the match. The
// project segment has already been resolved to `pagesProject` (resolveProject),
// so the allowlist pins the one project we manage.
export function isAllowed(
  method: string,
  path: string,
  pagesProject: string,
): boolean {
  const m = method.toUpperCase();
  const p = path.replace(/[?#].*$/, "").replace(/^\/+/, "");
  // Reject dot segments outright: fetch() normalizes `..` when it parses the
  // upstream URL, so `d1/../../user/tokens` would escape a prefix check.
  if (/(^|\/)\.\.?(\/|$)/.test(p)) return false;
  const project = `accounts/self/pages/projects/${pagesProject}`;

  switch (m) {
    case "GET":
      return (
        p === "user/tokens/verify" || // token validation / diagnostics
        p === KV || // list KV namespaces
        p === D1 || // list D1 databases
        p === R2 || // list R2 buckets
        p === project || // read the Pages project (bindings, subdomain)
        p === `${project}/deployments` // list deployments (status panel)
      );
    case "POST":
      return p === KV || p === D1 || p === R2; // create namespace / database / bucket
    case "PATCH":
      return p === project; // update deployment_configs (add bindings)
    default:
      return false;
  }
}

// Resolve the Pages-project placeholder BEFORE the allowlist: the client sends
// `pages/projects/self`, and only the server-configured project is ever allowed.
// The account placeholder is deliberately left untouched here (see below).
export function resolveProject(path: string, pagesProject: string): string {
  return path.replace(
    /(^\/*|\/)pages\/projects\/self(\/|$)/,
    `$1pages/projects/${pagesProject}$2`,
  );
}

// Substitute the account placeholder AFTER the allowlist check: `accounts/self/…`
// → `accounts/<accountId>/…`. Runs last so the secret account ID never takes part
// in the allowlist match. `user/tokens/verify` has no account segment and is
// returned unchanged.
export function substituteAccount(path: string, accountId: string): string {
  return path.replace(/^(\/*)accounts\/self\//, `$1accounts/${accountId}/`);
}
