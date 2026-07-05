// Login step 1 (multi-tenant flow) — send the browser to GitHub's authorize
// screen, but point the callback at the BROKER's one shared endpoint, not this
// site (design §3.1). No `scope` is requested: identity only. We plant a random
// `nonce` in a short-lived HttpOnly cookie AND echo it (with our own origin) in
// `state`; the broker copies both into the signed token, and our handoff endpoint
// checks the returned nonce against the cookie — one-shot, browser-bound CSRF.
// The nonce cookie is SameSite=None so it survives the broker's cross-site POST
// back to the handoff endpoint (a Lax cookie would be dropped on a cross-site POST).
import { cookie } from "../../../_lib/session";
import { BROKER_ORIGIN, GITHUB_CLIENT_ID } from "../../../_lib/tenant-config";

interface Env {
  GITHUB_CLIENT_ID?: string;
  BROKER_ORIGIN?: string;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;
  // client_id + broker origin come from the committed tenant-config (public, self-config),
  // with same-named env vars overriding for the dogfood/preview sites.
  const clientId = env.GITHUB_CLIENT_ID || GITHUB_CLIENT_ID;
  const broker = env.BROKER_ORIGIN || BROKER_ORIGIN;
  const origin = new URL(request.url).origin;
  const nonce = crypto.randomUUID();
  // URL-safe base64 (swap +/ → -_) so the state survives the OAuth round-trip
  // without a `+` being decoded to a space and corrupting it; keep padding (=).
  const state = btoa(JSON.stringify({ origin, nonce })).replace(/\+/g, "-").replace(/\//g, "_");

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", new URL("/api/auth/callback", broker).toString());
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": cookie("lanza_oauth_nonce", nonce, 600, "None"),
      // Never cache: this redirect carries a one-shot state+nonce; a cached copy
      // would replay a stale authorize request (the "worked in incognito only" bug).
      "Cache-Control": "no-store",
    },
  });
};
