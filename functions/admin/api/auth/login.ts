// Login step 1 (multi-tenant flow) — send the browser to GitHub's authorize
// screen, but point the callback at the BROKER's one shared endpoint, not this
// site (design §3.1). No `scope` is requested: identity only. We plant a random
// `nonce` in a short-lived HttpOnly cookie AND echo it (with our own origin) in
// `state`; the broker copies both into the signed token, and our handoff endpoint
// checks the returned nonce against the cookie — one-shot, browser-bound CSRF.
// The nonce cookie is SameSite=None so it survives the broker's cross-site POST
// back to the handoff endpoint (a Lax cookie would be dropped on a cross-site POST).
import { cookie } from "../../../_lib/session";

interface Env {
  GITHUB_CLIENT_ID?: string;
  BROKER_ORIGIN?: string;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;
  if (!env.GITHUB_CLIENT_ID) {
    return new Response("OAuth is not configured: GITHUB_CLIENT_ID is missing.", {
      status: 500,
    });
  }

  const broker = env.BROKER_ORIGIN ?? "https://lanzacms.com";
  const origin = new URL(request.url).origin;
  const nonce = crypto.randomUUID();
  const state = btoa(JSON.stringify({ origin, nonce }));

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", new URL("/api/auth/callback", broker).toString());
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": cookie("lanza_oauth_nonce", nonce, 600, "None"),
    },
  });
};
