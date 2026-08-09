// GitHub Device Flow — the secretless half of the auth path (docs/security-todo.md
// §10.1). Shared policy module: dependency-free and runtime-neutral (no Node or
// Workers globals) so it transpiles under Cloudflare's Pages bundler, Vite/esbuild
// and `node --experimental-strip-types` alike, exactly like gh-proxy.ts.
//
// THE POINT OF THIS FILE: grep it for "secret". There is none, because the flow
// does not have one — a `client_id` is public and appears in every authorize URL.
// GitHub resolves the App from the id alone, for login AND for refresh (both
// verified live, §3). That is what lets a tenant hold zero credentials.
//
// WHY A SERVER RELAY AT ALL: `github.com/login/*` sends no
// `Access-Control-Allow-Origin`, so the browser cannot call these two endpoints
// itself (verified 2026-08-09: OPTIONS → 404, POST → 200 with no ACAO). The shape
// is zero-SECRET, not zero-SERVER. `api.github.com` DOES send CORS, but we proxy it
// anyway so the token can live in an HttpOnly cookie instead of in JavaScript.

export const DEVICE_CODE_URL = "https://github.com/login/device/code";
export const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

// Scoped to /admin so none of these are ever sent on a cached public route, the
// same rule the outgoing session cookie follows.
export const ACCESS_COOKIE = "lanza_gh";
export const REFRESH_COOKIE = "lanza_gh_refresh";
export const DEVICE_COOKIE = "lanza_gh_device";

// GitHub's own default when it declines to say (it always does, in practice).
const DEFAULT_ACCESS_TTL = 8 * 3600;
// A device code is good for 15 minutes; the cookie holding it should not outlive it.
const DEVICE_CODE_TTL = 900;

export interface Tokens {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
}

/** What the SIGN-IN SCREEN is allowed to know. Deliberately not the device code. */
export interface DeviceView {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type StartResult =
  | { ok: true; deviceCode: string; view: DeviceView }
  | { ok: false; error: string };

// `pending` means "ask again" — the person has not finished at github.com yet.
// `error` is terminal: the code expired, or they refused. Collapsing the two would
// either spin forever on a refusal or give up on a slow typist.
export type PollResult =
  | { status: "ok"; tokens: Tokens }
  | { status: "pending"; error: string; interval?: number }
  | { status: "error"; error: string };

type Fetch = typeof globalThis.fetch;

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: {
    Accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
    "User-Agent": "lanza-cms",
  },
  body: new URLSearchParams(fields).toString(),
});

// GitHub answers these endpoints with a 200 carrying `{"error": …}` as often as it
// answers with a real status code, so the BODY is the source of truth and a
// non-2xx alone is not the test. A body that isn't JSON at all is an outage, not a
// refusal — say so rather than reporting a confident wrong reason.
async function post(
  fetchImpl: Fetch,
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, form(fields));
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { error: "github_unavailable" };
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Step 1 — ask GitHub for a device code. `client_id` is the only input.
 *
 * The caller keeps `deviceCode` server-side (in an HttpOnly cookie) and shows the
 * user only `view`. Nothing else needs it: the person reads `userCode` aloud off
 * the screen, and the polling request identifies itself with the cookie. That is a
 * deliberate improvement on the prototype, which handed the device code to the page
 * and took it back in the request body — where a second browser could present it.
 */
export async function startDeviceFlow(
  clientId: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<StartResult> {
  const data = await post(fetchImpl, DEVICE_CODE_URL, { client_id: clientId });
  const deviceCode = str(data.device_code);
  const userCode = str(data.user_code);
  const verificationUri = str(data.verification_uri);
  if (!deviceCode || !userCode || !verificationUri) {
    return { ok: false, error: str(data.error) ?? "device_flow_unavailable" };
  }
  return {
    ok: true,
    deviceCode,
    view: {
      userCode,
      verificationUri,
      expiresIn: num(data.expires_in) ?? DEVICE_CODE_TTL,
      // GitHub's minimum seconds between polls. Honour it — polling faster earns
      // `slow_down`, which costs more time than it saves.
      interval: num(data.interval) ?? 5,
    },
  };
}

/**
 * Step 2 — exchange the device code for tokens. Still no secret.
 *
 * `authorization_pending` (not finished yet) and `slow_down` (polling too fast) are
 * the normal path, not failures. `slow_down` carries a new interval that the caller
 * must adopt.
 */
export async function pollDeviceFlow(
  clientId: string,
  deviceCode: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<PollResult> {
  const data = await post(fetchImpl, ACCESS_TOKEN_URL, {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: DEVICE_GRANT,
  });
  return readTokens(data);
}

/**
 * Step 3 — refresh, with `client_id` and the refresh token and nothing else
 * (verified live, §3). GitHub returns a NEW refresh token each time with a fresh
 * 184-day life, so the window slides: someone who opens the CMS at least twice a
 * year never re-enters a device code. The caller must therefore store BOTH cookies
 * from the result, not just the access token.
 */
export async function refreshTokens(
  clientId: string,
  refreshToken: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<PollResult> {
  const data = await post(fetchImpl, ACCESS_TOKEN_URL, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return readTokens(data);
}

// Both token-issuing calls answer in the same shape, so they are read in one place.
function readTokens(data: Record<string, unknown>): PollResult {
  const accessToken = str(data.access_token);
  if (!accessToken) {
    const error = str(data.error) ?? "unknown_error";
    if (error === "authorization_pending") return { status: "pending", error };
    if (error === "slow_down") return { status: "pending", error, interval: num(data.interval) };
    return { status: "error", error };
  }
  return {
    status: "ok",
    tokens: {
      accessToken,
      // Absent `expires_in` means the App has expiring user tokens turned OFF, which
      // also means no refresh token ever arrives. Don't mint a cookie that outlives
      // what we can verify — cap it at the normal 8h and let the person sign in
      // again. §10 rejects that App setting outright; this is the safe reading if it
      // is ever flipped behind our back.
      expiresIn: num(data.expires_in) ?? DEFAULT_ACCESS_TTL,
      refreshToken: str(data.refresh_token),
      refreshExpiresIn: num(data.refresh_token_expires_in),
    },
  };
}

// ── Cookies ──────────────────────────────────────────────────────────────────
// HttpOnly so JavaScript never holds a durable credential (an XSS on /admin can
// still DRIVE the proxy while the page is open — true of the current design too,
// see frontend/lib/url.ts). Secure, and SameSite=Lax so nothing rides a cross-site
// request. Path=/admin keeps all three off every cached public route.
//
// Browsers treat http://localhost as a secure context, so `Secure` does not stop
// local dev.
export function cookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${value}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

const cleared = (name: string): string => `${name}=; Path=/admin; Max-Age=0`;

/** The device code, held server-side for the length of one sign-in attempt. */
export function deviceCookie(deviceCode: string): string {
  return cookie(DEVICE_COOKIE, deviceCode, DEVICE_CODE_TTL);
}

/**
 * The Set-Cookie headers for a successful sign-in or refresh, plus the clearing of
 * the device cookie (its one job is done, and a spent device code should not sit in
 * a browser). A refresh token is only written when GitHub sent one — never blank
 * out a live 184-day refresh token because a response happened to omit it.
 */
export function authCookies(tokens: Tokens): string[] {
  const out = [cookie(ACCESS_COOKIE, tokens.accessToken, tokens.expiresIn), cleared(DEVICE_COOKIE)];
  if (tokens.refreshToken) {
    out.push(cookie(REFRESH_COOKIE, tokens.refreshToken, tokens.refreshExpiresIn ?? 15897600));
  }
  return out;
}

/** Sign out: drop everything this module ever set. */
export function clearAuthCookies(): string[] {
  return [cleared(ACCESS_COOKIE), cleared(REFRESH_COOKIE), cleared(DEVICE_COOKIE)];
}

export function readCookie(header: string | null, name: string): string | undefined {
  return header?.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
}
