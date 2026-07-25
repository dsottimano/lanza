// OAuth 2.0 Protected Resource Metadata (RFC 9728) for this tenant's MCP endpoint.
// MCP clients (ChatGPT, Claude, Codex) fetch this — either from the `WWW-Authenticate`
// challenge on a 401 from /api/mcp, or directly — to learn which authorization server
// (the Lanza broker) issues tokens for this site. `resource` MUST be the exact canonical
// MCP URL the client connects to; the access-token audience is bound to it.
import { BROKER_ORIGIN as CONFIG_BROKER } from "../_lib/tenant-config";

interface Env {
  BROKER_ORIGIN?: string;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const origin = new URL(request.url).origin;
  const broker = env.BROKER_ORIGIN || CONFIG_BROKER;

  const metadata = {
    resource: `${origin}/api/mcp`,
    authorization_servers: [broker],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  };

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600", ...CORS },
  });
};
