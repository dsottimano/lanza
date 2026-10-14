// Site administration from the dedicated GitHub access branch.
// GitHub write access remains mandatory; CMS grants never grant hosting access.
import { identityFor, type IdentityResult } from "./gh-identity";
import { ContentClient } from "./lanza-content";
import { readAccessPolicy } from "./access-policy";
export { delegatedAdminLogins } from "./access-policy";

export interface SiteAccessEnv {
  LANZA_SITE_ADMINS?: string;
}

export async function siteIdentityFor(
  token: string,
  owner: string,
  name: string,
  env: SiteAccessEnv = {},
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<IdentityResult> {
  const result = await identityFor(token, owner, name, fetchImpl);
  if (result.status !== "ok" || result.identity.role !== "editor") return result;
  let logins: string[];
  try { logins = (await readAccessPolicy(new ContentClient({ owner, name }, token, false, fetchImpl), env.LANZA_SITE_ADMINS)).logins; }
  catch { return { status: "unavailable" }; }
  if (!logins.includes(result.identity.login.toLowerCase())) return result;
  // Read policy on every authorization, AFTER the GitHub-only identity cache.
  // Revocations require neither deployment nor a new login.
  return { status: "ok", identity: { ...result.identity, role: "owner", delegated: true } };
}
