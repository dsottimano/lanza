import repo from "../../../lanza.config.json";
import { ContentClient, GitHubError } from "../../_lib/lanza-content";
import { PluginRuntime, catalog, PLUGIN_BODY_LIMIT as REQUEST_BODY_LIMIT } from "../../_lib/plugin-runtime.mjs";
import { assertEntryPath } from "../../_lib/mcp-core";
import type { Role } from "../../_lib/roles";

function json(status: number, body: unknown): Response {
  return Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
async function payload(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > REQUEST_BODY_LIMIT) throw new GitHubError(413,"Request is too large.");
  const reader = request.body?.getReader(); if (!reader) throw new GitHubError(400,"Missing JSON body.");
  let text = ""; let bytes = 0; const decoder = new TextDecoder();
  try {
    for (;;) { const {done,value} = await reader.read(); if(done) break; bytes += value.byteLength; if(bytes > REQUEST_BODY_LIMIT) { await reader.cancel(); throw new GitHubError(413,"Request is too large."); } text += decoder.decode(value,{stream:true}); }
    try { return JSON.parse(text+decoder.decode()); } catch { throw new GitHubError(400,"Invalid JSON body."); }
  } finally { reader.releaseLock(); }
}
export const onRequest = async (context: {request:Request;data?:{role?:Role;login?:string;token?:string|null}}): Promise<Response> => {
  const {request,data} = context;
  if (!data?.token || !data.login) return json(401,{error:"Sign in with GitHub again.",code:"unauthorized"});
  if(data.role !== "owner") return json(403,{error:"Plugins are available to the site owner only.",code:"owner_required"});
  const url = new URL(request.url);
  if(!["GET","POST"].includes(request.method)) return json(405,{error:"Method not allowed.",code:"method_not_allowed"});
  // Cookie-authenticated writes need an exact Origin including scheme/port.
  if(request.method !== "GET" && request.headers.get("Origin") !== url.origin) return json(403,{error:"Same-origin request required.",code:"cross_origin"});
  const client = new ContentClient(repo,data.token);
  const runtime = new PluginRuntime(client,data.login,(path: string) => assertEntryPath(client,path));
  try {
    if(request.method === "GET") {
      const id = url.searchParams.get("id");
      return json(200,id ? await runtime.run(id,"read",{}) : {plugins:catalog()});
    }
    const body = await payload(request) as { id?: unknown; operation?: unknown; input?: unknown };
    if (!body || typeof body.id !== "string" || typeof body.operation !== "string") throw new GitHubError(400,"Choose a plugin and operation.");
    return json(200,await runtime.run(body.id,body.operation,body.input ?? {}));
  } catch(error) {
    const status = error instanceof GitHubError ? error.status : 503;
    return json(status,{error:error instanceof GitHubError ? error.message : "Could not access plugin data. Try again.",code:status===409?"conflict":status===403?"private_or_owner_required":status===400?"invalid_request":"request_failed"});
  }
};
