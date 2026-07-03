// OAuth step 1 — send the browser to GitHub's authorize screen. No `scope` is
// requested: this is identity only. The callback reads the login and discards
// the token, so a session never grants any GitHub access. A random `state` is
// stored in a short-lived HttpOnly cookie and echoed back by GitHub, so the
// callback can reject a forged/replayed authorization (CSRF).
import { cookie } from "../../../_lib/session";

interface Env {
  GITHUB_CLIENT_ID?: string;
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

  const state = crypto.randomUUID();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set(
    "redirect_uri",
    new URL("/admin/api/auth/callback", request.url).toString(),
  );
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": cookie("lanza_oauth_state", state, 600),
    },
  });
};
