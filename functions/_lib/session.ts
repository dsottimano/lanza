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

// The broker signs TWO families of token with ONE key: a 7-day CMS session (the
// `lanza_session` cookie) and a 1-hour MCP access token. A valid signature says only
// "the broker minted this" — it does not say which kind you are holding, and the two
// are not interchangeable. The CMS session is far the more powerful: it opens /admin,
// the GitHub proxy, and the account-scoped Cloudflare token.
//
// This mattered because the MCP token's audience is chosen by the client requesting it.
// A client that named a bare tenant origin as its `resource` received a token with the
// same `login`, the same `aud`, and the same signature as that site's CMS session — so
// it WAS that site's CMS session, in anyone's hands, one owner click away. The broker
// now refuses to mint one (it pins `resource` to an MCP endpoint, and labels both
// families with `typ`); this check is the half that lives on the tenant, so a site is
// protected even while talking to an older broker.
//
// Backward compatible on purpose: tokens minted before `typ` existed carry none, and
// still verify. Only a WRONG `typ` is refused, never a missing one — so no one is
// signed out. `scope` is the second tell: every OAuth access token has one (the
// authorize endpoint defaults it to "mcp"), and a CMS session has never carried one.
export type TokenFamily = "session" | "mcp";

// Full check: valid signature AND the expected token family AND audience-bound to THIS
// site AND unexpired. Returns the GitHub login, or null. `aud` is the tenant's own
// origin for a session, or `<origin>/api/mcp` for MCP — a token the broker minted for
// another site is rejected either way (the cross-tenant guard).
export async function verifySession(
  token: string | undefined,
  key: CryptoKey,
  aud: string,
  family: TokenFamily = "session",
): Promise<string | null> {
  const payload = await verifyRS256(token, key);
  if (!payload) return null;
  const { login, aud: tokenAud, exp, typ, scope } = payload;
  if (typ !== undefined && typ !== family) return null;
  // Only the session family is defined by the ABSENCE of `scope`; an MCP token always
  // has one, so this test would reject every legitimate caller if applied to both.
  // A non-string `scope` must be refused too, not ignored — the broker's verifier
  // rejects it outright, and a claim that means different things on either side of the
  // same key is exactly the asymmetry I5 exists to prevent. Not reachable today
  // (`scope` comes from a query parameter, so it is always a string), which is why it
  // is worth closing before something else signs with this key.
  if (family === "session" && scope !== undefined && (typeof scope !== "string" || scope)) return null;
  if (tokenAud !== aud) return null;
  if (typeof exp !== "number" || exp * 1000 <= Date.now()) return null;
  return typeof login === "string" ? login : null;
}

// The /admin authorization boundary: a valid session proves WHO you are, this
// decides whether that person owns this site. Every gate that admits a session
// must call it — a signature-only check admits any GitHub user on earth, since
// the broker signs a token for whoever authenticates. Case-insensitive and
// comma-list ready so extra editors can be added without a redeploy.
// `allowList` comes from env.ADMIN_LOGIN || lanza.config.json's adminLogin; the
// caller passes it so this module stays pure package code (no tenant imports).
export function isAllowedLogin(login: string | null | undefined, allowList: string): boolean {
  if (typeof login !== "string" || !login) return false;
  return allowList
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(login.toLowerCase());
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
