// Auth gate for the Lanza CMS — the replacement for Cloudflare Zero Trust
// (Access). This is a parent-directory middleware, so it runs for EVERY request
// under /admin/* (the static SPA and both api proxies) BEFORE the gh/cf Pages
// Functions execute. It deliberately lives at functions/admin/ and NOT at the
// project root: a root _middleware would run on the public site too and defeat
// its caching (see CLAUDE.md Rule 2). The /admin/api/auth/* endpoints are exempt
// so the login round-trip (login → broker → handoff) can complete while
// unauthenticated. The session cookie is a broker-signed RS256 token, verified
// here with the baked-in public key + bound to this site's origin (design §3.4-B).
import { SESSION_COOKIE, verifySession, importPublicKey, readCookie } from "../_lib/session";

interface Env {
  HANDOFF_PUBLIC_KEY?: string;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}): Promise<Response> => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // The login/handoff/logout endpoints must be reachable without a session.
  if (url.pathname.startsWith("/admin/api/auth/")) return next();

  let login: string | null = null;
  if (env.HANDOFF_PUBLIC_KEY) {
    const key = await importPublicKey(env.HANDOFF_PUBLIC_KEY);
    login = await verifySession(
      readCookie(request.headers.get("Cookie"), SESSION_COOKIE),
      key,
      url.origin,
    );
  }
  if (login) return next();

  // Unauthenticated. XHR/API calls get a JSON 401 (the SPA can surface a
  // "sign in" prompt); top-level navigations are redirected into the login flow.
  if (url.pathname.startsWith("/admin/api/")) {
    return new Response(JSON.stringify({ message: "Not authenticated." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return Response.redirect(
    new URL("/admin/api/auth/login", request.url).toString(),
    302,
  );
};
