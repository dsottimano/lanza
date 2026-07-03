// OAuth step 2 — GitHub redirects back here with a `code` and the `state` we
// planted. We verify the state (CSRF), exchange the code for a scopeless user
// token, read the login from /user, and enforce the ADMIN_LOGIN allowlist. On
// success we mint our own signed session cookie and redirect to a HARDCODED
// /admin/ (never a GitHub-supplied target — no open redirect). The GitHub token
// is used once here and never stored.
import { sign, cookie, readCookie } from "../../../_lib/session";

interface Env {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  ADMIN_LOGIN?: string;
}

const SESSION_TTL_SEC = 7 * 24 * 3600;

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(request.headers.get("Cookie"), "lanza_oauth_state");

  if (!code || !state || !expected || state !== expected) {
    return new Response("Bad OAuth state.", { status: 400 });
  }
  if (!env.SESSION_SECRET) {
    return new Response("Auth is not configured: SESSION_SECRET is missing.", {
      status: 500,
    });
  }

  // Exchange the code for a user access token (identity only, used once).
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL("/admin/api/auth/callback", request.url).toString(),
    }),
  });
  const tokenBody = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenBody.access_token) {
    const cid = env.GITHUB_CLIENT_ID ?? "";
    const sec = env.GITHUB_CLIENT_SECRET ?? "";
    return new Response(
      `OAuth token exchange failed: ${tokenBody.error ?? "no access_token"} — ${tokenBody.error_description ?? ""}\n` +
        `DEBUG: client_id len ${cid.length} (expect 20); client_secret len ${sec.length} (expect 40)`,
      { status: 401 },
    );
  }
  const token = tokenBody.access_token;

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "lanza-cms",
      Accept: "application/vnd.github+json",
    },
  });
  const login = ((await userRes.json()) as { login?: string }).login;

  // Allowlist: only the site owner's GitHub login(s) may enter. Case-insensitive
  // and comma-list ready so extra editors can be added later without a redeploy.
  const allowed = (env.ADMIN_LOGIN ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!login || !allowed.includes(login.toLowerCase())) {
    return new Response("This GitHub account is not authorized for this site.", {
      status: 403,
    });
  }

  const headers = new Headers({ Location: "/admin/" });
  headers.append(
    "Set-Cookie",
    cookie("lanza_session", await sign(login, env.SESSION_SECRET, SESSION_TTL_SEC), SESSION_TTL_SEC),
  );
  // Clear the one-shot state cookie.
  headers.append("Set-Cookie", "lanza_oauth_state=; Path=/admin; Max-Age=0");
  return new Response(null, { status: 302, headers });
};
