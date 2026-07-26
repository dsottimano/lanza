// Auth gate for the Lanza CMS — the replacement for Cloudflare Zero Trust
// (Access). This is a parent-directory middleware, so it runs for EVERY request
// under /admin/* (the static SPA and both api proxies) BEFORE the gh/cf Pages
// Functions execute. It deliberately lives at functions/admin/ and NOT at the
// project root: a root _middleware would run on the public site too and defeat
// its caching (see CLAUDE.md Rule 2). The /admin/api/auth/* endpoints are exempt
// so the login round-trip (login → broker → handoff) can complete while
// unauthenticated. The session cookie is a broker-signed RS256 token, verified
// here with the baked-in public key + bound to this site's origin (design §3.4-B).
import {
  SESSION_COOKIE,
  verifySession,
  importPublicKey,
  readCookie,
  isAllowedLogin,
} from "../_lib/session";
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
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${productionOrigin}${url.pathname}${url.search}`,
        "Cache-Control": "no-store",
      },
    });
  }

  // The login/handoff/logout endpoints must be reachable without a session.
  if (url.pathname.startsWith("/admin/api/auth/")) return next();

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
  // token for any GitHub user who logs in. Ownership is a separate check, and it
  // belongs here: /admin/api/cf/* trusts this middleware entirely and attaches an
  // account-scoped Cloudflare token.
  if (isAllowedLogin(login, env.ADMIN_LOGIN || repo.adminLogin)) return next();

  // Unauthenticated. XHR/API calls get a JSON 401 (the SPA can surface a
  // "sign in" prompt); top-level navigations are redirected into the login flow.
  if (url.pathname.startsWith("/admin/api/")) {
    return new Response(JSON.stringify({ message: "Not authenticated." }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL("/admin/api/auth/login", request.url).toString(),
      "Cache-Control": "no-store",
    },
  });
};
