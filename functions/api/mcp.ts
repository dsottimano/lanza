// Lanza CMS — MCP server (Cloudflare Pages Function, route: /api/mcp).
//
// Lets an external agent (ChatGPT / Claude / Codex) connect to a LIVE Lanza site and
// edit its content. Ships inside lanza-site, so every tenant that installs the CMS gets
// an MCP endpoint on their own domain automatically — the same way functions/admin/api/gh
// gives every tenant a GitHub proxy. Protocol + tools live in functions/_lib/mcp-core.ts;
// this file is transport + auth + the GitHub-token acquisition.
//
// Transport: MCP Streamable HTTP, STATELESS — each POST is a self-contained JSON-RPC
// exchange (no session/DO). GET (server→client SSE) is intentionally unsupported.
//
// Auth: the bearer IS a GitHub user token — the same `ghu_` token the CMS obtains by
// device flow, which the owner copies from /admin ("Connect an agent") and pastes into
// their MCP client. GitHub answers both questions, exactly as the /admin gate does:
// identity is whose token it is, and the role is `permissions` on this repo.
//
// This used to be an OAuth resource server with the broker as its authorization
// server, verifying a broker-signed RS256 bearer and minting repo write from the
// broker. Both were removed deliberately: the broker must not hold a credential that
// can reach a tenant it has finished onboarding (docs/release-plan.md R3/R4). Device
// flow cannot be an authorization server — there is no redirect, and GitHub does not
// support PKCE — so the token is carried, not brokered.
//
// GitHub writes use that same bearer. There is no mint, no installation token and no
// standing PAT: the agent writes as the person, with exactly the access GitHub already
// grants them.

import repo from "../../lanza.config.json";
import { ContentClient } from "../_lib/lanza-content";
import { identityFor } from "../_lib/gh-identity";
import { handleMessage, rpcError, type RpcMessage } from "../_lib/mcp-core";
import { stagingUrlFor } from "../_lib/pages-project";
import { WORKING_BRANCH } from "../_lib/gh-proxy";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 202 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
}

// 401. There is no OAuth discovery to point at any more: the bearer is a GitHub token
// the owner pastes in, so the useful thing to return is how to get one.
function unauthorized(message = "Unauthorized."): Response {
  return new Response(JSON.stringify(rpcError(null, -32001, message)), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer realm="Lanza", error="invalid_token"`,
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

// A JSON-RPC batch fans out to one handleMessage per element, each of which can make
// several GitHub calls. Workers cap a request at 50 subrequests, so an unbounded array
// is a free way to blow that ceiling (and to amplify one authenticated request into
// hundreds of writes). 20 is well above anything a real client sends.
const MAX_BATCH = 20;
export const MAX_MCP_BODY_BYTES = 2 * 1024 * 1024;

async function readPayload(request: Request): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MCP_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("MCP body too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const { request } = context;
  const origin = new URL(request.url).origin;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Stateless server: no server→client stream, so GET has nothing to open.
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
  }

  // --- The bearer is a GitHub user token; GitHub decides what it may do ---
  const auth = request.headers.get("Authorization") ?? "";
  const githubToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!githubToken) {
    return unauthorized("Unauthorized: paste the token from /admin → Connect an agent.");
  }

  if (Number(request.headers.get("content-length")) > MAX_MCP_BODY_BYTES) {
    return jsonResponse(rpcError(null, -32600, "MCP body too large (maximum 2 MiB)."), 413);
  }

  const identity = await identityFor(githubToken, repo.owner, repo.name);
  if (identity.status === "expired") {
    return unauthorized("Token expired: get a fresh one from /admin → Connect an agent.");
  }
  if (identity.status === "unavailable") {
    return jsonResponse(rpcError(null, -32000, "GitHub could not be reached to check this token."), 502);
  }
  // MCP is owner-only, as it has always been. An editor's write rules live in the
  // gh proxy, which this endpoint does not go through — so rather than reimplement
  // them here, the lesser role simply does not get an agent surface yet.
  if (identity.status === "denied" || identity.identity.role !== "owner") {
    return new Response(JSON.stringify(rpcError(null, -32002, "Forbidden: not the site owner.")), {
      status: 403,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
    });
  }

  let payload: unknown;
  try {
    payload = await readPayload(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse(rpcError(null, -32600, "MCP body too large (maximum 2 MiB)."), 413);
    }
    return jsonResponse(rpcError(null, -32700, "Parse error: body is not valid JSON."), 400);
  }

  const client = new ContentClient(repo, githubToken);

  // `origin` is this site's own address (the broker router forwards to the tenant, so
  // it stays the tenant's). The staging URL is resolved HERE rather than in mcp-core,
  // because on a custom domain it can only be derived from the repo identity — which
  // this module holds (lanza.config.json) and mcp-core deliberately does not.
  const site = {
    origin,
    stagingUrl: await stagingUrlFor(origin, WORKING_BRANCH, repo),
  };

  // Streamable HTTP accepts a single message or a batch (array).
  if (Array.isArray(payload)) {
    if (payload.length === 0) return jsonResponse(rpcError(null, -32600, "Empty batch."), 400);
    if (payload.length > MAX_BATCH) {
      return jsonResponse(rpcError(null, -32600, "Batch too large."), 400);
    }
    const responses = (
      await Promise.all(payload.map((m) => handleMessage(m as RpcMessage, client, site)))
    ).filter((r): r is Record<string, unknown> => r !== null);
    return responses.length ? jsonResponse(responses) : jsonResponse(null, 202);
  }

  const response = await handleMessage(payload as RpcMessage, client, site);
  return response ? jsonResponse(response) : jsonResponse(null, 202);
};
