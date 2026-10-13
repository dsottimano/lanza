import {
  AuthorizationError, CimdFetchError, OAuthProvider, authorizationErrorRedirect,
  insufficientScope, type AuthRequest, type ConsentDescription, type OAuthHelpers,
  type OAuthResourceAuth,
} from "@cloudflare/workers-oauth-provider";
import repo from "../../../lanza.config.json";
import { AGENT_CLIENT_ID } from "../../../functions/_lib/tenant-config";
import { startDeviceFlow, pollDeviceFlow, type DeviceView } from "../../../functions/_lib/device-flow";
import { siteIdentityFor, type SiteAccessEnv } from "../../../functions/_lib/site-access";
import { onRequest as mcp, MAX_MCP_BODY_BYTES } from "../../../functions/api/mcp";
import { SCOPES, SCOPE_LABELS, OAUTH_TOOLS, TOOL_SCOPES, missingScopes } from "./policy";

export interface Env extends Cloudflare.Env, SiteAccessEnv {
  AGENT_CLIENT_ID?: string;
  OAUTH_PROVIDER: OAuthHelpers;
}
interface DeviceState {
  deviceCode: string;
  view: DeviceView;
  expiresAt: number;
  nextPollAt: number;
}
interface McpContext { props: { githubToken?: unknown }; auth: OAuthResourceAuth }

export function canonicalOrigin(value: string): string {
  const url = new URL(value);
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.origin !== value || url.username || url.password) {
    throw new TypeError("Configure a canonical HTTPS origin (HTTP loopback only for local development).");
  }
  return url.origin;
}
const escape = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(body: string, headers = new Headers(), status = 200, script?: string): Response {
  const nonce = crypto.randomUUID();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect this Lanza site</title><style>body{font:18px/1.5 system-ui;max-width:42rem;margin:4rem auto;padding:0 1.5rem}label{display:block;margin:1rem 0}button{font:inherit;padding:.5rem 1rem;margin-right:1rem}code{font-size:1.5em}small{display:block}</style><main>${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</html>`, { status, headers });
}

function consentPage(details: ConsentDescription, handle: string): string {
  return `<h1>Connect ${escape(details.clientName)} to ${escape(repo.owner)}/${escape(repo.name)}?</h1>
    <p>${details.clientDomain ? `Client published by <strong>${escape(details.clientDomain)}</strong>.` : "This client's name is self-reported."}
    Authorization returns to <strong>${escape(details.redirectHost)}</strong>.</p>
    ${details.redirectIsLoopback ? "<p>This sends access to an app on your computer. Continue only if you started this connection.</p>" : ""}
    <p>GitHub must confirm you own this repository. Changes go to staging; publishing needs its own permission.</p>
    <form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(handle)}">
    ${SCOPES.map((scope) => `<label><input type="checkbox" name="scope" value="${scope}" ${scope === "content.read" || details.scope.includes(scope) ? "checked" : ""}> ${SCOPE_LABELS[scope]}</label>`).join("")}
    <button name="decision" value="approve">Continue to GitHub</button><button name="decision" value="deny">Cancel</button></form>`;
}

async function readLimited(request: Request, max: number): Promise<string> {
  if (!request.body) return "";
  if (Number(request.headers.get("Content-Length")) > max) throw new RangeError("Request too large.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new RangeError("Request too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function formData(request: Request, origin: string): Promise<URLSearchParams> {
  if (request.headers.get("Origin") !== origin) throw new AuthorizationError("invalid_request", { description: "This form must be submitted from the authorization page." });
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
    throw new AuthorizationError("invalid_request", { description: "Unsupported form." });
  }
  return new URLSearchParams(await readLimited(request, 8192));
}

async function devicePage(oauth: OAuthHelpers, original: AuthRequest, data: DeviceState, headers: Headers): Promise<Response> {
  const transaction = await oauth.beginUpstream(original, { data, headers });
  const seconds = Math.max(1, Math.ceil((data.nextPollAt - Date.now()) / 1000));
  // The fixed GitHub destination, never a client-provided URL. Neither device code
  // nor GitHub token is rendered. The handle is useless without its HttpOnly cookie.
  return page(`<h1>Authorize this repository on GitHub</h1><p>Enter this code at <a href="https://github.com/login/device" target="_blank" rel="noopener noreferrer">github.com/login/device</a>:</p><p><code>${escape(data.view.userCode)}</code></p><p>Install Lanza Agents on this repository if GitHub asks. This page finishes the connection when you approve.</p><form id="poll" method="post" action="/device"><input type="hidden" name="state" value="${escape(transaction.state)}"><button>Check authorization</button><button name="decision" value="deny">Cancel</button></form>`, transaction.headers, 200,
    `setTimeout(() => document.getElementById("poll").requestSubmit(), ${seconds * 1000});`);
}

export async function authHandler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (url.pathname === "/authorize" && request.method === "GET") {
      const original = await oauth.parseAuthRequest(request);
      if (original.scope.some((scope) => !SCOPES.includes(scope))) {
        return Response.redirect(authorizationErrorRedirect(original, "invalid_scope"), 302);
      }
      const details = await oauth.describeConsent(original);
      const consent = await oauth.beginConsent(original);
      return page(consentPage(details, consent.handle), consent.headers);
    }
    if (url.pathname === "/authorize" && request.method === "POST") {
      const form = await formData(request, env.OAUTH_ORIGIN);
      const handle = form.get("handle") ?? "";
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const scope = form.getAll("scope");
      if (!scope.includes("content.read")) return page("<p>Read access is required. Return to the client to start again.</p>", undefined, 400);
      const approved = await oauth.approveConsent(request, handle, { scope });
      const started = await startDeviceFlow(env.AGENT_CLIENT_ID || AGENT_CLIENT_ID);
      if (!started.ok) return page("<p>GitHub could not start authorization. Return to the client and reconnect.</p>", approved.headers, 502);
      const now = Date.now();
      const interval = Math.max(5, started.view.interval);
      return devicePage(oauth, approved.request, {
        deviceCode: started.deviceCode, view: started.view,
        expiresAt: now + Math.min(600, started.view.expiresIn) * 1000,
        nextPollAt: now + interval * 1000,
      }, approved.headers);
    }
    if (url.pathname === "/device" && request.method === "POST") {
      const form = await formData(request, env.OAUTH_ORIGIN);
      // finishUpstream accepts query state. The only caller input is the handle;
      // client, redirect, scope and device code are recovered from encrypted KV.
      const callback = new URL("/device", env.OAUTH_ORIGIN);
      callback.searchParams.set("state", form.get("state") ?? "");
      const resumed = await oauth.finishUpstream<DeviceState>(new Request(callback, { headers: request.headers }));
      const { request: original, data, headers } = resumed;
      if (form.get("decision") === "deny" || Date.now() >= data.expiresAt) {
        headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
        return new Response(null, { status: 302, headers });
      }
      if (Date.now() < data.nextPollAt) return devicePage(oauth, original, data, headers);
      const result = await pollDeviceFlow(env.AGENT_CLIENT_ID || AGENT_CLIENT_ID, data.deviceCode);
      if (result.status === "pending" || (result.status === "error" && result.error === "github_unavailable")) {
        const requestedInterval = result.status === "pending" && result.interval ? result.interval : data.view.interval;
        data.view.interval = Math.max(5, requestedInterval, result.status === "pending" && result.error === "slow_down" ? data.view.interval + 5 : data.view.interval);
        data.nextPollAt = Date.now() + data.view.interval * 1000;
        return devicePage(oauth, original, data, headers);
      }
      if (result.status !== "ok") {
        headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
        return new Response(null, { status: 302, headers });
      }
      // This first version supports the nonexpiring Agents App. Do not lose or
      // attempt uncoordinated refresh of a rotating upstream credential.
      if (result.tokens.refreshToken) return page("<p>This GitHub app uses expiring tokens. Use the nonexpiring Lanza Agents app and reconnect.</p>", headers, 400);
      const check = await siteIdentityFor(result.tokens.accessToken, repo.owner, repo.name, env);
      if (check.status === "unavailable") return page("<p>GitHub could not verify repository access. Reconnect when it is available.</p>", headers, 503);
      if (check.status !== "ok" || check.identity.role !== "owner") return page("<p>Only this repository's owner can connect it. Check the Lanza Agents installation and reconnect.</p>", headers, 403);
      const { redirectTo } = await oauth.completeAuthorization({
        request: original, userId: check.identity.login, metadata: {}, scope: original.scope,
        props: { githubToken: result.tokens.accessToken },
      });
      headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers });
    }
    return page("<p>Connect this tenant's /mcp endpoint from your MCP client. Authorization starts there.</p>", undefined, 404);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      // No redirects from form/callback errors: those are not newly validated URLs.
      if (url.pathname === "/authorize" && request.method === "GET" && error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      return page("<p>This authorization is invalid or expired. Return to the client and reconnect.</p>", undefined, 400);
    }
    if (error instanceof RangeError) return page("<p>Request too large.</p>", undefined, 413);
    // Never log exception objects: OAuth/client inputs can contain credentials.
    return page("<p>Authorization is temporarily unavailable. Return to the client and retry.</p>", undefined, 503);
  }
}

export async function mcpHandler(request: Request, env: Env, context: McpContext): Promise<Response> {
  if (new URL(request.url).pathname !== "/mcp") return new Response(null, { status: 404 });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
  const githubToken = context.props?.githubToken;
  if (typeof githubToken !== "string" || !githubToken.startsWith("ghu_")) return new Response(null, { status: 401 });
  let body: string;
  let payload: unknown;
  try { body = await readLimited(request, MAX_MCP_BODY_BYTES); payload = JSON.parse(body); }
  catch (error) { return new Response(null, { status: error instanceof RangeError ? 413 : 400 }); }
  const missing = missingScopes(payload, context.auth.scope);
  if (missing.length) return insufficientScope(context.auth, ["content.read", ...missing]);
  // Refuse unclassified tools for the whole batch BEFORE running any element.
  const messages = Array.isArray(payload) ? payload : [payload];
  for (const message of messages) {
    if (message?.method === "tools/call" && !Object.hasOwn(TOOL_SCOPES, String(message.params?.name))) {
      return Response.json({ error: "Unsupported tool." }, { status: 400 });
    }
  }
  // The upstream GitHub credential is internal only. Reuse all owner/path/staging
  // checks. SITE_ORIGIN is fixed tenant config, never a client URL or fetch target.
  const response = await mcp({ request: new Request(`${env.SITE_ORIGIN}/api/mcp`, {
    method: "POST", body, headers: { "Content-Type": "application/json", Authorization: `Bearer ${githubToken}` },
  }), env });
  if (response.status === 401) return Response.json({ error: "GitHub authorization expired or was revoked. Reconnect this tenant." }, {
    status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": `Bearer resource_metadata="${env.OAUTH_ORIGIN}/.well-known/oauth-protected-resource/mcp", error="invalid_token"` },
  });
  if (!response.ok || response.status === 202) return response;
  const result = await response.json() as Record<string, unknown> | Record<string, unknown>[];
  for (const item of Array.isArray(result) ? result : [result]) {
    const resultBody = item.result as { tools?: unknown } | undefined;
    if (resultBody && Array.isArray(resultBody.tools)) resultBody.tools = OAUTH_TOOLS;
  }
  return Response.json(result, { status: response.status, headers: response.headers });
}

export function providerFor(env: Env): OAuthProvider<Env> {
  const origin = canonicalOrigin(env.OAUTH_ORIGIN);
  canonicalOrigin(env.SITE_ORIGIN);
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { fetch: (request, env, ctx) => mcpHandler(request, env, ctx as unknown as McpContext) },
    defaultHandler: { fetch: authHandler },
    authorizeEndpoint: "/authorize", tokenEndpoint: "/oauth/token",
    // CIMD preferred; DCR remains for older privately registered MCP clients.
    clientIdMetadataDocumentEnabled: true, clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: SCOPES, requiredScopes: ["content.read"],
    accessTokenTTL: 3600, refreshTokenTTL: 30 * 86400, clientRegistrationTTL: 86400,
    tokenExchangeCallback: ({ scope }) => ({ refreshTokenTTL: scope.includes("offline_access") ? 30 * 86400 : 0 }),
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
    onError: () => undefined,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Reject aliases: issuer/resource values cannot drift with the Host header.
    try {
      if (new URL(request.url).origin !== canonicalOrigin(env.OAUTH_ORIGIN)) return new Response(null, { status: 421 });
      // MCP bearer requests can omit Origin. Browser requests must be same-origin;
      // ChatGPT and Codex contact the remote endpoint from their server runtime.
      const origin = request.headers.get("Origin");
      if (origin && origin !== env.OAUTH_ORIGIN) return new Response(null, { status: 403 });
      if (request.method === "POST" && new URL(request.url).pathname !== "/mcp") {
        const body = await readLimited(request, 16 * 1024);
        request = new Request(request, { body });
      }
      return await providerFor(env).fetch(request, env, ctx);
    } catch (error) {
      return new Response(error instanceof RangeError ? "Request too large." : "Tenant OAuth is not configured or temporarily unavailable.", {
        status: error instanceof RangeError ? 413 : 503, headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
