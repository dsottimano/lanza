// Auth gate for the Lanza CMS — the replacement for Cloudflare Zero Trust
// (Access). This is a parent-directory middleware, so it runs for EVERY request
// under /admin/* (the static SPA and both api proxies) BEFORE the gh/cf Pages
// Functions execute. It deliberately lives at functions/admin/ and NOT at the
// project root: a root _middleware would run on the public site too and defeat
// its caching (see CLAUDE.md Rule 2). The auth endpoints are exempt by exact match
// so the sign-in flow can complete while unauthenticated.
//
// Who you are comes from GITHUB: a device-flow user token in an HttpOnly cookie,
// and `permissions` on this repo for the role (docs/security-todo.md §10). An
// unauthenticated navigation is answered with the sign-in screen, not a redirect —
// device flow has nowhere to redirect to.
//
// It is also the only place /admin's security headers can be set: Cloudflare does
// not apply public/_headers to Pages Function responses, and this middleware wraps
// every /admin response. See functions/_lib/admin-gate.ts.
import {
  hasEncodedSeparator,
  isAuthExempt,
  withAdminSecurityHeaders,
} from "../_lib/admin-gate";
import { signInPage } from "../_lib/signin-page";
// Only for reading and clearing the outgoing session cookie — nothing verifies it
// here any more. `session.ts` goes in phase 4.
import { SESSION_COOKIE, readCookie } from "../_lib/session";
import { roleMayUseCloudflare, type Role } from "../_lib/roles";
import { identityFor } from "../_lib/gh-identity";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authCookies,
  clearAuthCookies,
  refreshTokens,
} from "../_lib/device-flow";
import {
  GITHUB_CLIENT_ID as CONFIG_CLIENT_ID,
  HANDOFF_PUBLIC_KEY as CONFIG_PUBLIC_KEY,
  productionOriginIfPreview,
} from "../_lib/tenant-config";
// Per-tenant identity — adminLogin is the /admin gate (same source the handoff
// endpoint checks). The broker writes this file at repo creation.
import repo from "../../lanza.config.json";

interface Env {
  HANDOFF_PUBLIC_KEY?: string;
  ADMIN_LOGIN?: string;
  GITHUB_CLIENT_ID?: string;
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

  const cookies = request.headers.get("Cookie");

  // ── Family 1 (incoming): a GitHub user token, and GitHub answers both questions.
  // Identity is "whose token is this", role is `permissions` on this repo — no list
  // of people is consulted, and removal of access takes effect within 60s.
  const gh = await githubAuth(cookies, env);

  // ── The broker's RS256 session is NO LONGER A WAY IN. ────────────────────────
  // Phase 2 accepted both families so that adding a way in did not close one. Phase
  // 3 took the mint off the runtime path, and that changed what the old session can
  // DO: nothing. The proxy has no GitHub token for it, so admitting it produced the
  // worst state in the product — the CMS loads, every call 401s, and the empty
  // result renders the onboarding wizard, on a site that has content. A credential
  // that opens a door onto a room where nothing works is worse than one that is
  // refused, because only the refusal tells you to sign in.
  //
  // It also closed a gap rather than opening one: /admin/api/cf/* does no
  // authorization of its own and attaches an ACCOUNT-scoped Cloudflare token (I1),
  // so until this line the 7-day unrevocable session still drove Cloudflare — by
  // then the only thing it could still drive.
  //
  // The code for that family is deleted in phase 4; this is the behaviour change,
  // made where the bug is.
  const role: Role | null = gh.kind === "ok" ? gh.role : null;
  const login: string | null = gh.kind === "ok" ? gh.login : null;

  if (!role) {
    const refused =
      gh.kind === "denied"
        ? deny(url, "This GitHub account cannot edit this repository.", 403)
        : gh.kind === "unavailable"
          ? deny(url, "GitHub could not be reached to check your access.", 503)
          : deny(url, "Not authenticated.");
    // Carry any cookie clearing through the refusal — a dead refresh token has to be
    // dropped on the response that noticed it, or the browser presents it forever.
    for (const set of gh.setCookies) refused.headers.append("set-cookie", set);
    // Drop the broker session too. It authorises nothing now, and leaving it in the
    // browser means every future request still carries a credential whose only
    // remaining effect would be to confuse whoever debugs this next.
    if (readCookie(cookies, SESSION_COOKIE)) {
      refused.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/admin; Max-Age=0`);
    }
    return refused;
  }

  // Cloudflare is owner-only and has no per-path nuance: that proxy performs no
  // authorization of its own and carries an ACCOUNT-scoped token, so this is the
  // whole gate for it (I1). Everything else an editor may reach is gated per
  // request by the gh proxy, which re-asks rather than trusting this admission.
  if (url.pathname.startsWith("/admin/api/cf/") && !roleMayUseCloudflare(role)) {
    return deny(url, "Only an owner can change hosting settings.");
  }

  // The gh proxy attaches this to its GitHub calls. It is handed over here rather
  // than re-read from the cookie downstream for the reason above: after a refresh
  // the cookie in the request is already dead. Absent for a browser on the old
  // RS256 session — the proxy has nothing to send for it, and says so (§10.8 phase 3).
  context.data = { ...(context.data ?? {}), role, login, token: gh.kind === "ok" ? gh.token : null };
  const response = withAdminSecurityHeaders(await next());
  // A refresh happened while answering this request. The gate is where it belongs:
  // it runs on EVERY /admin request — the SPA's own navigations included — and it
  // owns the response, so one implementation keeps every route signed in. (§10.1
  // put this in the gh proxy; the proxy only sees /admin/api/gh/*, so it would have
  // let a person who merely opened the CMS fall off after 8 hours.)
  for (const set of gh.setCookies) response.headers.append("set-cookie", set);
  return response;
};

/**
 * Family 1: turn the device-flow cookies into a role, refreshing once if the access
 * token has expired. Never throws and never denies on its own — it reports what
 * GitHub said and lets the gate decide.
 */
type GhAuth =
  | { kind: "none" | "expired" | "denied" | "unavailable"; setCookies: string[] }
  | { kind: "ok"; login: string; role: Role; token: string; setCookies: string[] };

async function githubAuth(cookies: string | null, env: Env): Promise<GhAuth> {
  const access = readCookie(cookies, ACCESS_COOKIE);
  const refresh = readCookie(cookies, REFRESH_COOKIE);
  if (!access && !refresh) return { kind: "none", setCookies: [] };

  let setCookies: string[] = [];
  // The token this request will actually use. It is NOT always the cookie that
  // arrived: a refresh below replaces it, and the gh proxy has to send the new one —
  // the browser only learns it from this response's Set-Cookie, which is too late
  // for the request in hand.
  let token = access;
  let result = access
    ? await identityFor(access, repo.owner, repo.name)
    : ({ status: "expired" } as const);

  // The access token lives 8 hours; the refresh token 184 days and rotating, so this
  // is the step that makes a device code a once-per-browser event rather than a
  // daily one. `client_id` and the refresh token, no secret (verified live, §10.9).
  if (result.status === "expired" && refresh) {
    const refreshed = await refreshTokens(env.GITHUB_CLIENT_ID || CONFIG_CLIENT_ID, refresh);
    if (refreshed.status === "ok") {
      setCookies = authCookies(refreshed.tokens);
      token = refreshed.tokens.accessToken;
      result = await identityFor(token, repo.owner, repo.name);
    } else if (refreshed.status === "error") {
      // The refresh token is spent or revoked. Drop all three cookies so the browser
      // stops presenting a credential that can never work again — leaving them would
      // send a dead token to GitHub on every future request.
      setCookies = clearAuthCookies();
    }
  }

  if (result.status === "ok") {
    // `token` is the very argument identityFor just answered about, so it is set.
    return { kind: "ok", ...result.identity, token: token as string, setCookies };
  }
  return { kind: result.status, setCookies };
}

// Unauthenticated. XHR/API calls get a JSON 401 (the SPA surfaces a "sign in"
// prompt); top-level navigations get the sign-in screen itself. `status` overrides
// the 401 when the reason is not "who are you" — 403 when GitHub knows them and
// says no, 503 when GitHub could not be asked. Neither is a login problem, and
// offering a sign-in would be a lie in both cases.
//
// It RENDERS rather than redirects because device flow has nowhere to redirect to:
// the person reads a code off a screen and types it at github.com. The 200 is the
// honest status for a page that loaded and works — the refusal is that the request
// never reached anything under /admin/ (§10.1 step 1).
function deny(url: URL, message: string, status = 401): Response {
  if (status !== 401 || url.pathname.startsWith("/admin/api/")) {
    return withAdminSecurityHeaders(
      new Response(JSON.stringify({ message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    );
  }
  const page = signInPage();
  return withAdminSecurityHeaders(
    new Response(page.html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    }),
    page.nonce,
  );
}
