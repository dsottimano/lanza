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
  isAllowedLogin,
} from "../../../_lib/session";
import { HANDOFF_PUBLIC_KEY as CONFIG_PUBLIC_KEY } from "../../../_lib/tenant-config";
// Per-tenant identity (owner/name/adminLogin) — the broker writes this at repo
// creation. adminLogin is the /admin gate; functions/ stays pure package code.
import repo from "../../../../lanza.config.json";

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
  // Env var overrides the committed config (dogfood/preview); otherwise the
  // template-baked public key is used — no manual setup on a generated tenant.
  const publicKey = env.HANDOFF_PUBLIC_KEY || CONFIG_PUBLIC_KEY;
  if (!publicKey) {
    return new Response("Auth is not configured: HANDOFF_PUBLIC_KEY is missing.", {
      status: 500,
    });
  }

  const key = await importPublicKey(publicKey);
  const payload = await verifyRS256(token, key);
  if (!payload) return new Response("Invalid handoff signature.", { status: 401 });

  const { login, aud, nonce, exp, typ, scope } = payload;
  // I5: say which token family you expect. This endpoint INSTALLS the session cookie,
  // so it is the last place that should infer it. An MCP access token is already
  // refused twice over here — it carries no `nonce`, and its `aud` ends `/api/mcp` —
  // but both of those are incidental. security-model.md §6 states the rule; this is
  // the line that makes it true rather than lucky.
  if (typ !== undefined && typ !== "session") {
    return new Response("Not a session token.", { status: 401 });
  }
  if (typeof scope === "string" && scope) {
    return new Response("Not a session token.", { status: 401 });
  }
  if (aud !== url.origin) return new Response("Handoff audience mismatch.", { status: 401 });
  if (!nonceCookie || nonce !== nonceCookie) {
    return new Response("Handoff nonce mismatch.", { status: 401 });
  }
  if (typeof exp !== "number" || exp * 1000 <= Date.now()) {
    return new Response("Handoff token expired.", { status: 401 });
  }

  // The security boundary: only the site owner's login(s) may enter. Shared with
  // the /admin middleware so both gates apply the identical rule.
  if (!isAllowedLogin(login as string | null, env.ADMIN_LOGIN || repo.adminLogin)) {
    return new Response("This GitHub account is not authorized for this site.", {
      status: 403,
    });
  }

  const headers = new Headers({ Location: "/admin/", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, token, SESSION_TTL_SEC));
  headers.append("Set-Cookie", "lanza_oauth_nonce=; Path=/admin; Max-Age=0");
  return new Response(null, { status: 302, headers });
};
