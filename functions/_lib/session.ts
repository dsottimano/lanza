// Tenant session — the verify half of the broker's RS256 handoff. Under the
// multi-tenant flow (design §3.4-B) a Lanza site holds NO signing secret: the
// broker mints a broker-signed session token, the tenant sets it as an HttpOnly
// cookie, and this module verifies it with the baked-in PUBLIC key. Mirror of the
// sign half in the broker repo's functions/_lib/jwt.ts — the two must stay
// byte-compatible (there's an interop test). Runtime-neutral WebCrypto only, so
// the same module works under Cloudflare's Pages bundler and Node dev.
export const SESSION_COOKIE = "lanza_session";
const enc = new TextEncoder();
const dec = new TextDecoder();

// A plain `new Uint8Array(len)` is ArrayBuffer-backed, which WebCrypto's
// BufferSource requires (Uint8Array.from is typed ArrayBufferLike and won't fit).
const bytes = (bin: string): Uint8Array<ArrayBuffer> => {
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
const unb64url = (s: string): Uint8Array<ArrayBuffer> => bytes(atob(s.replace(/-/g, "+").replace(/_/g, "/")));

// HANDOFF_PUBLIC_KEY is base64 of the PEM file (`base64 -w0 handoff_public.pem`):
// decode that, strip the PEM armor, base64-decode the inner body to DER.
const pemToDer = (pem: string, tag: string): Uint8Array<ArrayBuffer> =>
  bytes(
    atob(
      pem
        .replace(new RegExp(`-----BEGIN ${tag}-----`), "")
        .replace(new RegExp(`-----END ${tag}-----`), "")
        .replace(/\s+/g, ""),
    ),
  );

const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export async function importPublicKey(b64OfPem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", pemToDer(atob(b64OfPem), "PUBLIC KEY"), RSA, false, ["verify"]);
}

// Signature-only verify: decoded payload iff the RS256 signature is valid.
export async function verifyRS256(
  token: string | undefined,
  key: CryptoKey,
): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let ok = false;
  try {
    ok = await crypto.subtle.verify(RSA.name, key, unb64url(s), enc.encode(`${h}.${p}`));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    return JSON.parse(dec.decode(unb64url(p))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Full session check: valid signature AND audience-bound to THIS site AND unexpired.
// Returns the GitHub login, or null. `aud` is this tenant's own origin — a token the
// broker minted for another site is rejected here (that's the cross-tenant guard).
export async function verifySession(
  token: string | undefined,
  key: CryptoKey,
  aud: string,
): Promise<string | null> {
  const payload = await verifyRS256(token, key);
  if (!payload) return null;
  const { login, aud: tokenAud, exp } = payload;
  if (tokenAud !== aud) return null;
  if (typeof exp !== "number" || exp * 1000 <= Date.now()) return null;
  return typeof login === "string" ? login : null;
}

// Scoped to /admin so the cookie is never sent on public (cached) routes.
// HttpOnly (no JS access) + Secure (HTTPS only). SameSite defaults to Lax; the
// login nonce cookie overrides to "None" so it accompanies the broker's cross-site
// POST back to the tenant handoff (Lax would be withheld on a cross-site POST).
export function cookie(
  name: string,
  value: string,
  maxAgeSec: number,
  sameSite: "Lax" | "None" | "Strict" = "Lax",
): string {
  return `${name}=${value}; Path=/admin; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAgeSec}`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  return header?.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
}
