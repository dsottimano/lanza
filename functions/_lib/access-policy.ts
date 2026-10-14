import { ContentClient, GitHubError } from "./lanza-content";

export const ACCESS_BRANCH = "lanza-access";
const SHA = /^[a-f0-9]{40}$/;
export interface AccessPolicy { logins: string[]; revision: string; source: "github" | "legacy" }

export function delegatedAdminLogins(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 2048 || !value.trim()) return [];
  const names = value.split(",").map(name => name.trim().toLowerCase());
  if (names.length > 50 || names.some(name => !validLogin(name))) return [];
  return [...new Set(names)];
}
function validLogin(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(value) && !value.includes("--");
}
export function validateAdminLogins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some(login => !validLogin(login))) {
    throw new GitHubError(400, "Enter up to 50 valid GitHub usernames, without @.");
  }
  return [...new Set<string>(value.map(login => login.toLowerCase()))].sort();
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GitHubError(502, "Invalid co-admin policy response.");
  return value as Record<string, any>;
}
function checkedSha(value: unknown): string {
  if (typeof value !== "string" || !SHA.test(value)) throw new GitHubError(502, "Invalid co-admin policy revision.");
  return value;
}

export async function readAccessPolicy(client: ContentClient, legacy?: string): Promise<AccessPolicy> {
  const ref = await client.siteAccessPolicy("GET", `git/ref/heads/${ACCESS_BRANCH}`);
  // Only a missing branch permits the old hosting setting. Errors, malformed
  // policies and explicit empty lists never resurrect a legacy grant.
  if (ref === null) return { logins: delegatedAdminLogins(legacy), revision: `legacy:${typeof legacy === "string" ? legacy : ""}`, source: "legacy" };
  const head = object(ref);
  if (head.ref !== `refs/heads/${ACCESS_BRANCH}` || object(head.object).type !== "commit") throw new GitHubError(502, "Invalid co-admin policy branch.");
  const revision = checkedSha(head.object.sha);
  const file = object(await client.siteAccessPolicy("GET", `contents/policy.json?ref=${revision}`));
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string" || file.content.length > 8192) throw new GitHubError(502, "Invalid co-admin policy file.");
  let policy;
  try { policy = object(JSON.parse(atob(file.content.replace(/\s/g, "")))); }
  catch { throw new GitHubError(502, "Invalid co-admin policy file."); }
  if (policy.version !== 1) throw new GitHubError(502, "Unsupported co-admin policy version.");
  const logins = validateAdminLogins(policy.admins);
  return { logins, revision, source: "github" };
}

export async function saveAccessPolicy(client: ContentClient, current: AccessPolicy, input: unknown): Promise<AccessPolicy> {
  const logins = validateAdminLogins(input);
  const content = JSON.stringify({ version: 1, admins: logins }, null, 2) + "\n";
  const tree = object(await client.siteAccessPolicy("POST", "git/trees", { tree: [{ path: "policy.json", mode: "100644", type: "blob", content }] }));
  const commit = object(await client.siteAccessPolicy("POST", "git/commits", {
    message: "Update Lanza co-admins [skip ci]", tree: checkedSha(tree.sha),
    parents: current.source === "github" ? [checkedSha(current.revision)] : [],
  }));
  const revision = checkedSha(commit.sha);
  try {
    const result = object(await client.siteAccessPolicy(current.source === "github" ? "PATCH" : "POST",
      current.source === "github" ? `git/refs/heads/${ACCESS_BRANCH}` : "git/refs",
      current.source === "github" ? { sha: revision, force: false } : { ref: `refs/heads/${ACCESS_BRANCH}`, sha: revision }));
    if (result.ref !== `refs/heads/${ACCESS_BRANCH}` || object(result.object).sha !== revision) throw new GitHubError(502, "GitHub did not confirm the saved co-admin policy. Reload to check its state.");
  } catch (error) {
    if (error instanceof GitHubError && [409, 422].includes(error.status)) throw new GitHubError(409, "Co-admins changed or GitHub refused the update. Reload before saving again.");
    throw error;
  }
  return { logins, revision, source: "github" };
}
