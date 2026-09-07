// Self-configuring tenant. These are PUBLIC values, safe to commit, and identical
// for every Lanza site — baked into the template so a generated repo needs no manual
// setup to sign in. An env var of the same name overrides.
//
// Verified empty 2026-08-29: the lanzacms.com Pages project now carries ZERO
// variables. Every one it had (ADMIN_LOGIN, GH_APP_ID, GH_APP_PRIVATE_KEY,
// GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET) belonged to a design that
// no longer exists, and a tenant needs none of them to work.
//
// Per-tenant identity (owner/name) is NOT here — it lives in the repo-root
// lanza.config.json, which the onboarding broker writes per tenant at repo creation.
// Keeping it out of functions/ lets the whole dir ship as pure lanza-site code.
//
// The broker's ORIGIN is still named here for onboarding links. Nothing it signs is
// trusted at runtime any more: the handoff public key that used to live below was
// deleted with the session family it verified (docs/release-plan.md).
export const BROKER_ORIGIN = "https://connect.lanzacms.com";

// The shared lanza-cms GitHub App's OAuth client_id — PUBLIC (it appears in every
// authorize URL) and identical for every tenant. Committed so a generated site logs in
// with no manual env var; an env `GITHUB_CLIENT_ID` of the same name overrides.
export const GITHUB_CLIENT_ID = "Iv23ct5fK2N5QtDUbzyx";

// The "Lanza Agents" App (github.com/apps/lanza-agents) — also public, also
// identical for every tenant, and deliberately a SECOND App rather than a second
// use of the one above.
//
// The difference is one setting: this App does NOT expire user authorization
// tokens. That is wrong for the CMS, where an 8-hour token plus a silent
// server-side refresh is what keeps a leaked cookie short-lived. It is right here,
// because the token is pasted into an MCP client's configuration and nothing can
// refresh it there — an expiring token would mean re-pasting three times a day.
//
// The trade is stated where the person makes it (the Connect an agent screen): the
// token is good until revoked, and revoking is one click at
// github.com/settings/applications. Contents-only, so it can edit the repository
// and do nothing else.
export const AGENT_CLIENT_ID = "Iv23lieeiFXkwsOETNGj";
export const AGENT_APP_SLUG = "lanza-agents";

// Is this request being served by a Cloudflare Pages PREVIEW build, and if so what
// is the production origin?
//
// Pages gives a preview two addresses — a rolling branch alias
// (`staging.<project>.pages.dev`) and a permanent hash URL
// (`<hash>.<project>.pages.dev`) — while production is the bare
// `<project>.pages.dev`. The sign-in cookies are set on the production origin, so
// /admin can never authenticate on a preview host.
//
// There is also nothing to gain by trying: the production CMS ALREADY writes to the
// staging branch. A preview host is for LOOKING at the result. Two near-identical
// URLs where the wrong one half-loads a CMS that can never work is the single most
// confusing thing in this product — so we don't explain it, we remove it.
//
// Narrow on purpose: only `*.pages.dev` with more labels than production. A custom
// domain returns null, because a preview can't be told from an apex there and
// redirecting a healthy live site to itself would be a loop.
export function productionOriginIfPreview(hostname: string): string | null {
  if (!hostname.endsWith(".pages.dev")) return null;
  const labels = hostname.split(".");
  if (labels.length <= 3) return null;
  return `https://${labels.slice(-3).join(".")}`;
}
