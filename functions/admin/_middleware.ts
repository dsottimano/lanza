// Auth gate for the Lanza CMS — the replacement for Cloudflare Zero Trust
// (Access). This is a parent-directory middleware, so it runs for EVERY request
// under /admin/* (the static SPA and both api proxies) BEFORE the gh/cf Pages
// Functions execute. It deliberately lives at functions/admin/ and NOT at the
// project root: a root _middleware would run on the public site too and defeat
// its caching (see CLAUDE.md Rule 2). The /admin/api/auth/* endpoints are exempt
// so the OAuth login round-trip can complete while unauthenticated.
import { SESSION_COOKIE, verify, readCookie } from "../_lib/session";

interface Env {
  SESSION_SECRET?: string;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}): Promise<Response> => {
  const { request, env, next } = context;
  const { pathname } = new URL(request.url);

  // The login/callback/logout endpoints must be reachable without a session.
  if (pathname.startsWith("/admin/api/auth/")) return next();

  const login = await verify(
    readCookie(request.headers.get("Cookie"), SESSION_COOKIE),
    env.SESSION_SECRET ?? "",
  );
  if (login) return next();

  // Unauthenticated. XHR/API calls get a JSON 401 (the SPA can surface a
  // "sign in" prompt); top-level navigations are redirected into the OAuth flow.
  if (pathname.startsWith("/admin/api/")) {
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
