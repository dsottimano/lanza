// Signed session cookie — minted by the OAuth callback (functions/admin/api/auth/
// callback.ts) and verified by the /admin gate (functions/admin/_middleware.ts).
// Runtime-neutral (WebCrypto only, no Node/Workers specifics), like the proxy
// libs beside it, so the same module works under Cloudflare's Pages bundler and
// Vite/Node dev. The session carries only the GitHub login + an expiry — never a
// GitHub token; the server-side GITHUB_TOKEN stays in the proxy.
export const SESSION_COOKIE = "lanza_session";
const enc = new TextEncoder();

const b64url = (b: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64url = (s: string): string => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

// token = base64url(JSON{login,exp}) + "." + hmac(payload)
export async function sign(login: string, secret: string, ttlSec: number): Promise<string> {
  const payload = b64url(
    enc.encode(JSON.stringify({ login, exp: Date.now() + ttlSec * 1000 })),
  );
  return `${payload}.${await hmac(secret, payload)}`;
}

// Returns the login iff the signature verifies AND the token hasn't expired.
// An empty secret fails closed (returns null) — a missing SESSION_SECRET denies
// everyone rather than silently accepting unsigned tokens.
export async function verify(
  token: string | undefined,
  secret: string,
): Promise<string | null> {
  if (!secret || !token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (sig !== (await hmac(secret, payload))) return null;
  try {
    const { login, exp } = JSON.parse(unb64url(payload)) as { login?: unknown; exp?: unknown };
    return typeof login === "string" && typeof exp === "number" && exp > Date.now()
      ? login
      : null;
  } catch {
    return null;
  }
}

// Scoped to /admin so the cookie is never sent on public (cached) routes.
// HttpOnly (no JS access) + Secure (HTTPS only) + SameSite=Lax (survives the
// top-level redirect back from github.com; Strict would drop it).
export function cookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${value}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  return header?.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
}
