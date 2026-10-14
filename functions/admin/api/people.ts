import repo from "../../../lanza.config.json";
import { identityFor } from "../../_lib/gh-identity";
import { type SiteAccessEnv } from "../../_lib/site-access";
import { ContentClient, GitHubError } from "../../_lib/lanza-content";
import { readAccessPolicy, saveAccessPolicy } from "../../_lib/access-policy";
import type { Role } from "../../_lib/roles";

type Env = SiteAccessEnv;
interface Input { action?: unknown; expectedRevision?: unknown; logins?: unknown }
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
    const client = new ContentClient(repo, data.token);
    const current = await readAccessPolicy(client, env.LANZA_SITE_ADMINS);
    if (request.method === "GET") return json(200, current);
    const body = await boundedJson<Input>(request, 8192);
    if (!body || body.action !== "save") throw new PeopleError(400, "Invalid people action.");
    if (body.expectedRevision !== current.revision) throw new PeopleError(409, "Co-admins changed since you loaded them. Reload before saving.");
    const saved = await saveAccessPolicy(client, current, body.logins);
    return json(200, { ...saved, saved: true });
  } catch (error) {
    return json(error instanceof PeopleError || error instanceof GitHubError ? error.status : 503, { error: error instanceof PeopleError || error instanceof GitHubError ? error.message : "Could not reach the access management service. Try again." });
  }
};
