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
// Auth: OAuth 2.1 (MCP authorization spec). This endpoint is a RESOURCE SERVER — the
// broker (connect.lanzacms.com) is the authorization server. An unauthenticated request
// gets 401 + `WWW-Authenticate` pointing at /.well-known/oauth-protected-resource, which
// kicks off the browser OAuth flow in ChatGPT/Claude/Codex (no keys pasted). The access
// token is a broker-signed RS256 JWT ({login, aud: this-mcp-url}); we verify it with the
// baked-in public key (same as the CMS session) and require login == the site owner.
//
// GitHub writes: we mint a short-lived, repo-scoped App installation token from the
// broker's /api/token (forwarding the access token as the session — it carries the
// owner login), exactly like the gh proxy. No standing PAT. A GITHUB_TOKEN env var, if
// set, is a self-host fallback when the broker is UNAVAILABLE — never when it refuses
// (I2; the mint is functions/_lib/broker-token.ts, shared so that distinction is
// written once).

import repo from "../../lanza.config.json";
import { mintRepoToken, type TokenCache } from "../_lib/broker-token";
import { ContentClient } from "../_lib/lanza-content";
import { handleMessage, rpcError, type RpcMessage } from "../_lib/mcp-core";
import { importPublicKey, verifySession } from "../_lib/session";
import { BROKER_ORIGIN as CONFIG_BROKER, HANDOFF_PUBLIC_KEY as CONFIG_PUBLIC_KEY } from "../_lib/tenant-config";

interface Env {
  BROKER_ORIGIN?: string;
  HANDOFF_PUBLIC_KEY?: string;
  GITHUB_TOKEN?: string;
}

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

// 401 that triggers OAuth discovery: point the client at this site's protected-resource
// metadata (MUST be on a 401, not a 200 — Claude ignores the header on 200).
function unauthorized(origin: string): Response {
  const prm = `${origin}/.well-known/oauth-protected-resource`;
  return new Response(JSON.stringify(rpcError(null, -32001, "Unauthorized.")), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${prm}"`,
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

// Best-effort per-isolate cache of the repo-scoped installation token (same token for
// every request; ~1h). A miss just re-mints — correctness never depends on it.
const tokenCache: TokenCache = new Map();

// A JSON-RPC batch fans out to one handleMessage per element, each of which can make
// several GitHub calls. Workers cap a request at 50 subrequests, so an unbounded array
// is a free way to blow that ceiling (and to amplify one authenticated request into
// hundreds of writes). 20 is well above anything a real client sends.
const MAX_BATCH = 20;

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Stateless server: no server→client stream, so GET has nothing to open.
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
  }

  // --- OAuth token validation (resource server) ---
  const auth = request.headers.get("Authorization") ?? "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!accessToken) return unauthorized(origin);

  const publicKey = env.HANDOFF_PUBLIC_KEY || CONFIG_PUBLIC_KEY;
  // The token's audience must be THIS site's MCP URL (RFC 8707) — a token minted for
  // another Lanza site is rejected here. The "mcp" family additionally refuses a CMS
  // session presented as a bearer: the two are signed with one key, so audience alone
  // is not what separates them (see session.ts).
  const login = await verifySession(
    accessToken,
    await importPublicKey(publicKey),
    `${origin}/api/mcp`,
    "mcp",
  );
  if (!login) return unauthorized(origin);
  // Only the site owner may drive the CMS.
  if (login.toLowerCase() !== repo.adminLogin.toLowerCase()) {
    return new Response(JSON.stringify(rpcError(null, -32002, "Forbidden: not the site owner.")), {
      status: 403,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
    });
  }

  // --- GitHub write token: broker-minted (repo-scoped, ~1h), PAT fallback for self-host ---
  const broker = env.BROKER_ORIGIN || CONFIG_BROKER;
  const minted = broker
    ? await mintRepoToken(broker, accessToken, repo.owner, repo.name, tokenCache)
    : null;
  // A refusal is final (I2). Only an UNAVAILABLE broker may fall through to the PAT —
  // otherwise revoking the GitHub App, or failing the broker's own audience check,
  // would silently upgrade the caller to the standing whole-account token.
  if (minted === "denied") {
    return new Response(
      JSON.stringify(rpcError(null, -32002, "Forbidden: the broker refused to mint a token for this session.")),
      { status: 403, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } },
    );
  }
  const githubToken = minted ? minted.token : (env.GITHUB_TOKEN ?? null);
  if (!githubToken) {
    return jsonResponse(
      rpcError(null, -32000, "No GitHub token: the broker was unavailable and no GITHUB_TOKEN fallback is set."),
      502,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error: body is not valid JSON."), 400);
  }

  const client = new ContentClient(repo, githubToken);

  // `origin` is this site's own address (the broker router forwards to the tenant,
  // so it stays the tenant's). get_site derives the staging URL from it.
  // Streamable HTTP accepts a single message or a batch (array).
  if (Array.isArray(payload)) {
    if (payload.length > MAX_BATCH) {
      return jsonResponse(rpcError(null, -32600, "Batch too large."), 400);
    }
    const responses = (
      await Promise.all(payload.map((m) => handleMessage(m as RpcMessage, client, origin)))
    ).filter((r): r is Record<string, unknown> => r !== null);
    return responses.length ? jsonResponse(responses) : jsonResponse(null, 202);
  }

  const response = await handleMessage(payload as RpcMessage, client, origin);
  return response ? jsonResponse(response) : jsonResponse(null, 202);
};
