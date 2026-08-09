// Auth gate for the Lanza CMS — the replacement for Cloudflare Zero Trust
// (Access). This is a parent-directory middleware, so it runs for EVERY request
// under /admin/* (the static SPA and both api proxies) BEFORE the gh/cf Pages
// Functions execute. It deliberately lives at functions/admin/ and NOT at the
// project root: a root _middleware would run on the public site too and defeat
// its caching (see CLAUDE.md Rule 2). Three exact auth endpoints are exempt so the
// login round-trip (login → broker → handoff) can complete while unauthenticated.
// The session cookie is a broker-signed RS256 token, verified here with the
// baked-in public key + bound to this site's origin (design §3.4-B).
//
// It is also the only place /admin's security headers can be set: Cloudflare does
// not apply public/_headers to Pages Function responses, and this middleware wraps
// every /admin response. See functions/_lib/admin-gate.ts.
import {
  hasEncodedSeparator,
  isAuthExempt,
  withAdminSecurityHeaders,
} from "../_lib/admin-gate";
import {
  SESSION_COOKIE,
  verifySession,
  importPublicKey,
  readCookie,
} from "../_lib/session";
import { resolveRole, roleMayUseCloudflare } from "../_lib/roles";
import {
  HANDOFF_PUBLIC_KEY as CONFIG_PUBLIC_KEY,
  productionOriginIfPreview,
} from "../_lib/tenant-config";
// Per-tenant identity — adminLogin is the /admin gate (same source the handoff
// endpoint checks). The broker writes this file at repo creation.
import repo from "../../lanza.config.json";

interface Env {
  HANDOFF_PUBLIC_KEY?: string;
  ADMIN_LOGIN?: string;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
  // Pages hands `data` to the downstream Function. The gh proxy reads the role from
  // here rather than re-deriving it, so there is one place that decides who you are.
  data?: Record<string, unknown>;
}): Promise<Response> => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // FIRST, before any auth work: there is no CMS on a preview build. The session is
  // bound to the production origin, so every path from here 403s or bounces to a
  // GitHub login that can't help. Send the whole of /admin/* to the live site,
  // carrying the path and query across. The SPA's `#/...` route is lost, because a
  // fragment is never sent to a server — the CMS opens at its default screen.
  //
  // This runs ahead of the /admin/api/auth/ exemption deliberately — starting a login
  // round-trip on a preview host is precisely the dead end being removed.
  const productionOrigin = productionOriginIfPreview(url.hostname);
  if (productionOrigin) {
    return withAdminSecurityHeaders(
      new Response(null, {
        status: 302,
        headers: {
          Location: `${productionOrigin}${url.pathname}${url.search}`,
          "Cache-Control": "no-store",
        },
      }),
    );
  }

  // An encoded path separator or dot segment (%2f/%5c/%2e) is refused outright,
  // before anything below reads the path. The gate reads `url.pathname`, which
  // leaves those encoded, while the router may not — and every check from here on
  // is a string comparison against that pathname. Rather than decide who decodes
  // what, refuse the only inputs where the two can disagree (I3).
  if (hasEncodedSeparator(url.pathname)) {
    return deny(url, "Malformed path.");
  }

  // The login/handoff/logout endpoints must be reachable without a session. This is
  // an EXACT match, not a prefix — see isAuthExempt for the bypass a prefix allowed.
  if (isAuthExempt(url.pathname)) return withAdminSecurityHeaders(await next());

  let login: string | null = null;
  const publicKey = env.HANDOFF_PUBLIC_KEY || CONFIG_PUBLIC_KEY;
  if (publicKey) {
    const key = await importPublicKey(publicKey);
    login = await verifySession(
      readCookie(request.headers.get("Cookie"), SESSION_COOKIE),
      key,
      url.origin,
    );
  }
  // A valid signature only proves the broker authenticated SOMEONE — it mints a
  // token for any GitHub user who logs in. Authorization is a separate check, and it
  // belongs here: /admin/api/cf/* trusts this middleware entirely and attaches an
  // account-scoped Cloudflare token.
  //
  // Two roles now, not one. `adminLogin` is unchanged and still means full access;
  // `editors` is the invited, content-only role. An env ADMIN_LOGIN keeps overriding
  // the committed owner list for a self-hosted site, exactly as before.
  const role = resolveRole(login, env.ADMIN_LOGIN || repo.adminLogin, repo.editors);
  if (!role) return deny(url, "Not authenticated.");

  // Cloudflare is owner-only and has no per-path nuance: that proxy performs no
  // authorization of its own and carries an ACCOUNT-scoped token, so this is the
  // whole gate for it (I1). Everything else an editor may reach is gated per
  // request by the gh proxy, which re-asks rather than trusting this admission.
  if (url.pathname.startsWith("/admin/api/cf/") && !roleMayUseCloudflare(role)) {
    return deny(url, "Only an owner can change hosting settings.");
  }

  context.data = { ...(context.data ?? {}), role, login };
  return withAdminSecurityHeaders(await next());
};

// Unauthenticated. XHR/API calls get a JSON 401 (the SPA can surface a "sign in"
// prompt); top-level navigations are redirected into the login flow.
function deny(url: URL, message: string): Response {
  if (url.pathname.startsWith("/admin/api/")) {
    return withAdminSecurityHeaders(
      new Response(JSON.stringify({ message }), {
        status: 401,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    );
  }
  return withAdminSecurityHeaders(
    new Response(null, {
      status: 302,
      headers: {
        Location: new URL("/admin/api/auth/login", url).toString(),
        "Cache-Control": "no-store",
      },
    }),
  );
}
