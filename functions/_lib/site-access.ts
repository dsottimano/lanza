// Optional site administration granted by the tenant's hosting operator.
// Never read this policy from a request, content file or repository commit: any
// GitHub writer can edit those. GitHub access remains mandatory and revocable.
import { identityFor, type IdentityResult } from "./gh-identity";

export interface SiteAccessEnv {
  LANZA_SITE_ADMINS?: string;
}

export function delegatedAdminLogins(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 2048 || !value.trim()) return [];
  const names = value.split(",").map(name => name.trim().toLowerCase());
  // No globs, partial matches, URLs, empty elements or silently ignored typos.
  if (names.length > 50 || names.some(name =>
    !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(name) || name.includes("--"))) return [];
  return [...new Set(names)];
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
  if (!delegatedAdminLogins(env.LANZA_SITE_ADMINS).includes(result.identity.login.toLowerCase())) return result;
  // Apply deployment policy AFTER the GitHub-only cache. A grant from one
  // environment must never contaminate another request or survive policy removal.
  return { status: "ok", identity: { ...result.identity, role: "owner", delegated: true } };
}
