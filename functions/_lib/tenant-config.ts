// Self-configuring tenant (design §3.4). These are PUBLIC values, safe to commit,
// and identical for every Lanza site — baked into the template so a generated repo
// needs no manual setup to log in. Env vars of the same name override them
// (BROKER_ORIGIN / HANDOFF_PUBLIC_KEY), which the dogfood + preview sites use.
//
// Per-tenant identity (owner/name/adminLogin) is NOT here — it lives in the repo-root
// lanza.config.json, which the onboarding broker writes per tenant at repo creation.
// Keeping it out of functions/ lets the whole dir ship as pure lanza-site code.
export const BROKER_ORIGIN = "https://connect.lanzacms.com";

// The shared lanza-cms GitHub App's OAuth client_id — PUBLIC (it appears in every
// authorize URL) and identical for every tenant. Committed so a generated site logs in
// with no manual env var; an env `GITHUB_CLIENT_ID` of the same name overrides.
export const GITHUB_CLIENT_ID = "Iv23ct5fK2N5QtDUbzyx";

// Is this request being served by a Cloudflare Pages PREVIEW build, and if so what
// is the production origin?
//
// Pages gives a preview two addresses — a rolling branch alias
// (`staging.<project>.pages.dev`) and a permanent hash URL
// (`<hash>.<project>.pages.dev`) — while production is the bare
// `<project>.pages.dev`. A session's `aud` claim is bound to the production origin,
// so /admin can never authenticate on a preview host.
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

export const HANDOFF_PUBLIC_KEY =
  "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUF0blBYTlBoQVQ5Qk1GQStuZGtEaApEa3VPSytrRmVGQ1d3SVZtaUpzQWZ5blg3Umt1MWdkYmVZKzRsOGI0M0NEcHJMQzVqNEc4aTYvenNNWE1La0kwCkRTNVNGcm9ua3VXS3lmdENUbE1kTzFDWkhMREMyYVkyZHN4c1g4KzJtMjMrOEJYQ0RodkVmV0J3cWlkSm4wcTEKZHRMOG5DdWJLazJBVllQaW80bVpPYldBeUR6YUdBdWQxSTlUcmdxeXRhdk1HMXdObnFMRlV6RUNUTm9ZNXBTWAp5YW5ONEczeDlsQzRnbStieTJnRG1jUXQzMThrYTRBMCticDRzMGhYRmN0UjZNc0d0K1duWHdMQVYzVTFkSysxClRtV1NEd05YRW1qcVFVU291czVpcm5SNjN2Ni82YkNsYlNmQ2ZmdTJvYzVkV2pSZ1ZBSFR6UXpDSWpPMVNyeEoKV3dJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==";
