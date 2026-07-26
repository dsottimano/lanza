// Is this CMS being served from a Cloudflare Pages PREVIEW build?
//
// Pages gives every preview deployment two addresses — a rolling branch alias
// (`staging.<project>.pages.dev`) and a permanent hash URL
// (`<hash>.<project>.pages.dev`). Production is the bare `<project>.pages.dev`.
//
// This matters because a session is cryptographically bound to the production
// origin (the broker's `aud` claim — see lanza-broker/_lib/tenant-origin.ts), so
// /admin on a preview host can never mint a repo token and every GitHub call comes
// back 403. Without this check the CMS blames a missing GITHUB_TOKEN, which sends
// people hunting a secret that was never the problem.
//
// It is also the right answer product-wise: there is nothing to fix, because the
// production admin ALREADY writes to the staging branch. A preview host is for
// looking at the result, not for editing it.
//
// Deliberately narrow: only `*.pages.dev` with more labels than production. A custom
// domain returns null — we can't tell a preview from an apex there, and guessing
// wrong would accuse a perfectly healthy site.
export function productionOriginIfPreview(host?: string): string | null {
  const hostname = host ?? (typeof window === "undefined" ? "" : window.location.hostname);
  if (!hostname.endsWith(".pages.dev")) return null;
  const labels = hostname.split(".");
  // <project>.pages.dev === 3 labels === production. Anything longer is a preview.
  if (labels.length <= 3) return null;
  return `https://${labels.slice(-3).join(".")}`;
}
