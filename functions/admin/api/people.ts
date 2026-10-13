import repo from "../../../lanza.config.json";
import { identityFor } from "../../_lib/gh-identity";
import { delegatedAdminLogins, type SiteAccessEnv } from "../../_lib/site-access";
import type { Role } from "../../_lib/roles";

interface Env extends SiteAccessEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  PAGES_PROJECT?: string;
}
interface Input {
  action?: unknown; connection?: { token?: unknown; account?: unknown; project?: unknown };
  deploymentId?: unknown; expectedRevision?: unknown; logins?: unknown;
}
interface Project {
  source?: { type?: string; config?: { owner?: string; repo_name?: string } };
  production_branch?: string;
  deployment_configs?: { production?: { env_vars?: Record<string, { type?: string; value?: string } | null> } };
}
interface Deployment { id?: string; environment?: string; latest_stage?: { name?: string; status?: string } }
class PeopleError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function boundedJson<T>(message: Request | Response, limit: number): Promise<T> {
  const reader = message.body?.getReader();
  if (!reader) throw new PeopleError(400, "Missing response or request body.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new PeopleError(413, "Request or response is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new PeopleError(400, "Invalid JSON."); }
}
export const onRequest = async (context: {
  request: Request; env?: Env;
  data?: { token?: string | null; role?: Role; delegated?: boolean };
}): Promise<Response> => {
  const { request, data } = context; const env = context.env ?? {};
  if (!data?.token) return json(401, { error: "Sign in with GitHub again." });
  if (data.role !== "owner" || data.delegated) return json(403, { error: "Only a GitHub repository administrator can manage co-admins." });
  if (!["GET", "POST"].includes(request.method)) return json(405, { error: "Method not allowed." });
  if (request.method === "POST" && request.headers.get("Origin") !== new URL(request.url).origin) return json(403, { error: "Same-origin request required." });
  try {
    // Recheck the raw GitHub identity: delegated site roles never grant this capability.
    const identity = await identityFor(data.token, repo.owner, repo.name);
    if (identity.status !== "ok") throw new PeopleError(identity.status === "unavailable" ? 503 : 403, "GitHub could not confirm repository administration.");
    if (identity.identity.role !== "owner") throw new PeopleError(403, "Only a GitHub repository administrator can manage co-admins.");
    if (request.method === "GET") return json(200, {
      active: delegatedAdminLogins(env.LANZA_SITE_ADMINS),
      configured: !!(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID && env.PAGES_PROJECT),
      project: env.PAGES_PROJECT || repo.pagesProject || "",
    });
    const body = await boundedJson<Input>(request, 8192);
    if (!body || (typeof body.action !== "string" || !["read", "save", "deploy", "status"].includes(body.action))) throw new PeopleError(400, "Invalid people action.");
    // A configured server credential can never be redirected by browser input.
    const serverToken = env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID && env.PAGES_PROJECT ? env.CLOUDFLARE_API_TOKEN : undefined;
    const token = serverToken || body.connection?.token;
    const account = serverToken ? env.CLOUDFLARE_ACCOUNT_ID : body.connection?.account;
    const project = serverToken ? env.PAGES_PROJECT : body.connection?.project;
    if (typeof token !== "string" || !token || token.length > 2048 || /[\r\n]/.test(token) ||
        typeof account !== "string" || !/^[a-f0-9]{32}$/i.test(account) ||
        typeof project !== "string" || !/^[a-z0-9][a-z0-9-]{0,57}$/.test(project)) throw new PeopleError(400, "Connect the site's Cloudflare account and Pages project first.");
    const base = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}`;
    async function cf<T = Project>(path = "", init: RequestInit = {}): Promise<T> {
      const response = await fetch(base + path, { ...init, redirect: "error", headers: { Authorization: `Bearer ${token}`, ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) } });
      if (!response.ok) throw new PeopleError(502, `Cloudflare refused the request (${response.status}). Check the token's Pages Edit permission and account.`);
      const envelope = await boundedJson<{ success?: boolean; result?: T }>(response, 1_048_576);
      if (envelope?.success !== true || !envelope.result) throw new PeopleError(502, "Cloudflare could not complete the request.");
      return envelope.result;
    }
    const current = await cf();
    if (current.source?.type !== "github" ||
        current.source.config?.owner?.toLowerCase() !== repo.owner.toLowerCase() ||
        current.source.config?.repo_name?.toLowerCase() !== repo.name.toLowerCase()) throw new PeopleError(403, "This Pages project is not connected to this site's GitHub repository.");
    if (typeof current.production_branch !== "string" || !current.production_branch) throw new PeopleError(409, "The project has no production branch.");
    const setting = current.deployment_configs?.production?.env_vars?.LANZA_SITE_ADMINS;
    if (setting && (setting.type !== "plain_text" || typeof setting.value !== "string")) throw new PeopleError(409, "The existing co-admin setting is encrypted. Change it to a plaintext username list in Cloudflare before managing it here.");
    const revision = setting?.value ?? "";
    if (revision.trim() && !delegatedAdminLogins(revision).length) throw new PeopleError(409, "The current co-admin setting is malformed. Correct it in Cloudflare first.");
    const result = { logins: delegatedAdminLogins(revision), revision };
    if (body.action === "read") return json(200, result);
    if (body.action === "status") {
      if (typeof body.deploymentId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(body.deploymentId)) throw new PeopleError(400, "Invalid deployment ID.");
      const deployment = await cf<Deployment>(`/deployments/${body.deploymentId}`);
      return json(200, { ...result, deployment: { id: deployment.id, stage: deployment.latest_stage?.name, status: deployment.latest_stage?.status, environment: deployment.environment } });
    }
    if (body.expectedRevision !== revision) throw new PeopleError(409, "Co-admins changed since you loaded them. Reload before saving.");
    if (body.action === "save") {
      if (!Array.isArray(body.logins) || body.logins.length > 50 || body.logins.some((login: unknown) => typeof login !== "string" || delegatedAdminLogins(login).length !== 1 || String(login).includes(","))) throw new PeopleError(400, "Enter valid GitHub usernames, without @.");
      const value = [...new Set<string>(body.logins.map((login: string) => login.trim().toLowerCase()))].join(",");
      if (value.length > 2048) throw new PeopleError(400, "Too many usernames.");
      // PATCH only this key. Never echo Cloudflare secrets or replace other bindings.
      await cf("", { method: "PATCH", body: JSON.stringify({ deployment_configs: { production: { env_vars: { LANZA_SITE_ADMINS: { type: "plain_text", value } } } } }) });
      result.logins = delegatedAdminLogins(value); result.revision = value;
    }
    // Saving and deploying are separate outcomes. A failed deployment must not be
    // reported as a failed save or an active grant. Retry never rewrites the list.
    try {
      const form = new FormData(); form.set("branch", current.production_branch);
      const deployment = await cf<Deployment>("/deployments", { method: "POST", body: form });
      if (!deployment.id) throw new PeopleError(502, "Cloudflare did not return a deployment ID.");
      return json(200, { ...result, saved: true, deployment: { id: deployment.id, stage: deployment.latest_stage?.name, status: deployment.latest_stage?.status, environment: deployment.environment } });
    } catch {
      return json(200, { ...result, saved: true, deployment: null, warning: "Co-admins are saved, but the deployment could not start. Retry deployment; access has not changed yet." });
    }
  } catch (error) {
    return json(error instanceof PeopleError ? error.status : 503, { error: error instanceof PeopleError ? error.message : "Could not reach the access management service. Try again." });
  }
};
