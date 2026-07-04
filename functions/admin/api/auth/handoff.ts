// Login step 2 (multi-tenant flow) — the broker 302s here with a broker-signed
// RS256 session token (design §3.1 step 6). We verify it with the baked-in PUBLIC
// key and enforce every claim before trusting it:
//   • signature      — only the broker's private key could have signed it
//   • aud == origin   — a token minted for another tenant is rejected here
//   • nonce == cookie — one-shot + browser-bound (CSRF); the token can't be replayed
//   • not expired
//   • login == ADMIN_LOGIN — THE real gate: only this site's owner may enter, so a
//     token phished onto the wrong origin is useless (design §3.3).
// The broker delivers the token by auto-submitting a POST form (not a redirect
// query string), so the bearer arrives in the request BODY and never lands in a
// URL/history/log. On success we set it as the HttpOnly session cookie and clear
// the nonce.
import {
  SESSION_COOKIE,
  cookie,
  readCookie,
  importPublicKey,
  verifyRS256,
} from "../../../_lib/session";

interface Env {
  HANDOFF_PUBLIC_KEY?: string;
  ADMIN_LOGIN?: string;
}

const SESSION_TTL_SEC = 7 * 24 * 3600;

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
  const form = await request.formData();
  const raw = form.get("token");
  const token = typeof raw === "string" ? raw : undefined;
  const nonceCookie = readCookie(request.headers.get("Cookie"), "lanza_oauth_nonce");

  if (!token) return new Response("Missing handoff token.", { status: 400 });
  if (!env.HANDOFF_PUBLIC_KEY) {
    return new Response("Auth is not configured: HANDOFF_PUBLIC_KEY is missing.", {
      status: 500,
    });
  }

  const key = await importPublicKey(env.HANDOFF_PUBLIC_KEY);
  const payload = await verifyRS256(token, key);
  if (!payload) return new Response("Invalid handoff signature.", { status: 401 });

  const { login, aud, nonce, exp } = payload;
  if (aud !== url.origin) return new Response("Handoff audience mismatch.", { status: 401 });
  if (!nonceCookie || nonce !== nonceCookie) {
    return new Response("Handoff nonce mismatch.", { status: 401 });
  }
  if (typeof exp !== "number" || exp * 1000 <= Date.now()) {
    return new Response("Handoff token expired.", { status: 401 });
  }

  // The security boundary: only the site owner's login(s) may enter. Case-insensitive
  // and comma-list ready so extra editors can be added without a redeploy.
  const allowed = (env.ADMIN_LOGIN ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (typeof login !== "string" || !allowed.includes(login.toLowerCase())) {
    return new Response("This GitHub account is not authorized for this site.", {
      status: 403,
    });
  }

  const headers = new Headers({ Location: "/admin/", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, token, SESSION_TTL_SEC));
  headers.append("Set-Cookie", "lanza_oauth_nonce=; Path=/admin; Max-Age=0");
  return new Response(null, { status: 302, headers });
};
