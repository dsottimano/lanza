import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as bindings } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";
import { OAUTH_TOOLS, TOOL_SCOPES, missingScopes } from "./policy";
import { TOOL_LIST } from "../../../functions/_lib/mcp-core";
import { resetIdentityCache } from "../../../functions/_lib/gh-identity";
import repo from "../../../lanza.config.json";

const env = bindings as unknown as Env;
const ORIGIN = "https://oauth.example.com";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "https://chat.example.com/callback";
const GITHUB_TOKEN = "ghu_fixture_tenant_owner";
const REPO_PATH = `/repos/${repo.owner}/${repo.name}`;

// Refuse every unplanned network call. Request execution, crypto and KV are real
// workerd; only GitHub's external responses are fixtures.
const upstream: Array<{ url: string; method: string; status: number; body: unknown }> = [];
const fetchMock = {
  get(origin: string) { return { intercept({ path, method = "GET" }: { path: string; method?: string }) {
    return { reply(status: number, body: unknown) { upstream.push({ url: origin + path, method, status, body }); } };
  } }; },
  activate() { vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = options?.method ?? (input instanceof Request ? input.method : "GET");
    const index = upstream.findIndex((item) => item.url === url && item.method === method);
    if (index < 0) throw new Error(`Unexpected upstream request: ${method} ${url}`);
    const [fixture] = upstream.splice(index, 1);
    return Response.json(fixture.body, { status: fixture.status });
  }); },
  disableNetConnect() {},
  assertNoPendingInterceptors() { expect(upstream).toEqual([]); },
  deactivate() { upstream.length = 0; },
};

class Browser {
  cookies = new Map<string, string>();
  async request(path: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("Cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { ...options, headers }), env, ctx);
    await waitOnExecutionContext(ctx);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [key, value] = pair.split("=");
      if (cookie.includes("Max-Age=0")) this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
    return response;
  }
  post(path: string, form: Record<string, string> | URLSearchParams) {
    return this.request(path, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  }
}
function hidden(html: string, name: string): string {
  const value = html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  expect(value).toBeTruthy();
  return value!;
}
async function register(browser: Browser, clientName = "Fixture MCP client") {
  const response = await browser.request("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: clientName, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
  expect(response.status).toBe(201);
  return (await response.json() as { client_id: string }).client_id;
}
async function authorize(browser: Browser, scope = "content.read offline_access", clientName?: string) {
  const clientId = await register(browser, clientName);
  const verifier = "v".repeat(64);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", scope, state: "client-state", code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE });
  const response = await browser.request(`/authorize?${query}`);
  expect(response.status).toBe(200);
  const html = await response.text();
  return { clientId, verifier, handle: hidden(html, "handle"), html };
}
function startGithub() {
  fetchMock.get("https://github.com").intercept({ path: "/login/device/code", method: "POST" }).reply(200, { device_code: "fixture-secret-device-code", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
}
function owner(role: "owner" | "editor" = "owner") {
  fetchMock.get("https://api.github.com").intercept({ path: "/user" }).reply(200, { login: "tenant-owner" });
  fetchMock.get("https://api.github.com").intercept({ path: REPO_PATH }).reply(200, { permissions: { admin: role === "owner", push: true, pull: true } });
}
async function start(browser: Browser, auth: Awaited<ReturnType<typeof authorize>>, scopes = ["content.read", "offline_access"]) {
  startGithub();
  const form = new URLSearchParams({ handle: auth.handle, decision: "approve" });
  for (const scope of scopes) form.append("scope", scope);
  const response = await browser.post("/authorize", form);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("ABCD-EFGH");
  expect(html).not.toContain("fixture-secret-device-code");
  expect(html).not.toContain(GITHUB_TOKEN);
  return hidden(html, "state");
}
async function finish(browser: Browser, state: string, role: "owner" | "editor" = "owner") {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 6000);
  fetchMock.get("https://github.com").intercept({ path: "/login/oauth/access_token", method: "POST" }).reply(200, { access_token: GITHUB_TOKEN });
  owner(role);
  return browser.post("/device", { state });
}
async function exchange(browser: Browser, auth: Awaited<ReturnType<typeof authorize>>, code: string, extra: Record<string, string> = {}) {
  return browser.post("/oauth/token", { grant_type: "authorization_code", client_id: auth.clientId, redirect_uri: REDIRECT, code, code_verifier: auth.verifier, resource: RESOURCE, ...extra });
}
async function connected(scope = "content.read offline_access") {
  const browser = new Browser();
  const auth = await authorize(browser, scope);
  const state = await start(browser, auth, scope.split(" "));
  const response = await finish(browser, state);
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get("Location")!);
  expect(callback.origin).toBe(new URL(REDIRECT).origin);
  expect(callback.searchParams.get("state")).toBe("client-state");
  expect(callback.searchParams.get("iss")).toBe(ORIGIN);
  const code = callback.searchParams.get("code")!;
  expect(callback.href).not.toContain(GITHUB_TOKEN);
  const tokenResponse = await exchange(browser, auth, code);
  expect(tokenResponse.status).toBe(200);
  const tokens = await tokenResponse.json() as { access_token: string; refresh_token: string; resource: string };
  expect(tokens.access_token).not.toBe(GITHUB_TOKEN);
  expect(JSON.stringify(tokens)).not.toContain(GITHUB_TOKEN);
  expect(tokens.resource).toBe(RESOURCE);
  return { browser, auth, state, code, tokens };
}
async function call(browser: Browser, token: string, method: string, params?: unknown) {
  return browser.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}

beforeEach(async () => {
  const keys = await env.OAUTH_KV.list();
  await Promise.all(keys.keys.map((key) => env.OAUTH_KV.delete(key.name)));
  fetchMock.activate(); fetchMock.disableNetConnect(); resetIdentityCache();
});
afterEach(() => { fetchMock.assertNoPendingInterceptors(); fetchMock.deactivate(); vi.restoreAllMocks(); });

describe("tenant OAuth MCP service in workerd", () => {
  it("publishes issuer/resource metadata, S256 and CIMD and challenges missing tokens", async () => {
    const browser = new Browser();
    const metadata = await (await browser.request("/.well-known/oauth-authorization-server")).json() as Record<string, unknown>;
    expect(metadata.issuer).toBe(ORIGIN);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    const resource = await (await browser.request("/.well-known/oauth-protected-resource/mcp")).json() as Record<string, unknown>;
    expect(resource.resource).toBe(RESOURCE);
    expect(resource.authorization_servers).toEqual([ORIGIN]);
    expect(resource.scopes_supported).toEqual(["content.read"]);
    const unauth = await call(browser, "", "tools/list");
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
  });

  it("requires write consent to answer requests while read consent can inspect them", () => {
    for (const name of ["list_agent_requests", "read_agent_request", "list_translations"]) {
      expect(missingScopes({ method: "tools/call", params: { name } }, ["content.read"])).toEqual([]);
      expect(OAUTH_TOOLS.find(tool => tool.name === name)?.annotations.readOnlyHint).toBe(true);
    }
    const answer = { method: "tools/call", params: { name: "respond_to_agent_request" } };
    expect(missingScopes(answer, ["content.read"])).toEqual(["content.write"]);
    expect(missingScopes({ method: "tools/call", params: { name: "create_translation" } }, ["content.read"])).toEqual(["content.write"]);
    expect(missingScopes(answer, ["content.read", "content.write"])).toEqual([]);
    expect(OAUTH_TOOLS.find(tool => tool.name === "respond_to_agent_request")?.securitySchemes)
      .toEqual([{ type: "oauth2", scopes: ["content.read", "content.write"] }]);
  });

  it("classifies every existing tool and advertises explicit scopes and read hints", () => {
    expect(Object.keys(TOOL_SCOPES).sort()).toEqual(TOOL_LIST.map((t) => t.name).sort());
    expect(OAUTH_TOOLS.find((t) => t.name === "get_schema")?.annotations.readOnlyHint).toBe(true);
    expect(OAUTH_TOOLS.find((t) => t.name === "publish")?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["content.read", "site.publish"] }]);
  });

  it("accepts the official ChatGPT CIMD identity with its registered callback", async () => {
    const browser = new Browser();
    const clientId = "https://chatgpt.com/oauth/client.json";
    const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
    for (let n = 0; n < 2; n++) fetchMock.get("https://chatgpt.com").intercept({ path: "/oauth/client.json" }).reply(200, { client_id: clientId, client_name: "ChatGPT", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    const response = await browser.request(`/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: "content.read", resource: RESOURCE, code_challenge: "A".repeat(43), code_challenge_method: "S256", state: "fixture" })}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("chatgpt.com");
  });

  it("rejects a forged redirect, missing PKCE, plain PKCE and unsupported scopes", async () => {
    const browser = new Browser();
    const clientId = await register(browser);
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: "https://attacker.example/callback", response_type: "code", scope: "content.read", resource: RESOURCE });
    const forged = await browser.request(`/authorize?${params}`);
    expect(forged.status).toBe(400);
    expect(forged.headers.get("Location")).toBeNull();
    params.set("redirect_uri", REDIRECT);
    const missing = await browser.request(`/authorize?${params}`);
    expect([400, 302]).toContain(missing.status);
    expect(await missing.clone().text()).not.toContain("name=\"handle\"");
    params.set("code_challenge", "v".repeat(64)); params.set("code_challenge_method", "plain");
    const plain = await browser.request(`/authorize?${params}`);
    expect([400, 302]).toContain(plain.status);
    expect(await plain.clone().text()).not.toContain("name=\"handle\"");
    params.set("code_challenge_method", "S256"); params.set("code_challenge", "A".repeat(43)); params.set("scope", "repo:all");
    const scope = await browser.request(`/authorize?${params}`);
    expect(scope.status).toBe(302);
    expect(new URL(scope.headers.get("Location")!).searchParams.get("error")).toBe("invalid_scope");
  });

  it("escapes client metadata and denies consent before starting GitHub", async () => {
    const browser = new Browser();
    const auth = await authorize(browser, "content.read", '<img src=x onerror="alert(1)">');
    expect(auth.html).not.toContain("<img src=x");
    expect(auth.html).toContain("&#60;img");
    expect(auth.html).toContain("chat.example.com");
    const response = await browser.post("/authorize", { handle: auth.handle, decision: "deny" });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("Location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("rejects consent stolen by another browser and cross-origin forms", async () => {
    const browser = new Browser();
    const auth = await authorize(browser);
    expect((await new Browser().post("/authorize", { handle: auth.handle, decision: "approve", scope: "content.read" })).status).toBe(400);
    const response = await browser.request("/authorize", { method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/x-www-form-urlencoded" }, body: `handle=${auth.handle}&decision=approve&scope=content.read` });
    expect(response.status).toBe(403);
  });

  it("issues opaque OAuth tokens, runs the existing owner gate, and exposes scoped tools", async () => {
    const { browser, tokens } = await connected();
    const response = await call(browser, tokens.access_token, "tools/list");
    expect(response.status).toBe(200);
    const result = await response.json() as { result: { tools: typeof OAUTH_TOOLS } };
    expect(result.result.tools).toEqual(OAUTH_TOOLS);
    expect(JSON.stringify(result)).not.toContain(GITHUB_TOKEN);
    // KV has only encrypted credential props. No plaintext GitHub secret.
    const keys = await env.OAUTH_KV.list();
    for (const key of keys.keys) expect(await env.OAUTH_KV.get(key.name)).not.toContain(GITHUB_TOKEN);
  });

  it("reads persisted Git content using the tenant-owned GitHub credential", async () => {
    const { browser, tokens } = await connected();
    const schema = [{ kind: "folder", name: "pages", folder: "content/pages", fields: [{ name: "title", widget: "string" }] }];
    fetchMock.get("https://api.github.com").intercept({ path: `${REPO_PATH}/contents/data/schema.json?ref=staging` }).reply(200, { content: btoa(JSON.stringify(schema)) });
    const response = await call(browser, tokens.access_token, "tools/call", { name: "get_schema" });
    expect(response.status).toBe(200);
    const result = await response.json() as { result: { content: Array<{ text: string }> } };
    expect(JSON.parse(result.result.content[0].text)).toEqual(schema);
  });

  it("denies a scoped write and entire mixed batch before any GitHub operation", async () => {
    const { browser, tokens } = await connected();
    const write = await call(browser, tokens.access_token, "tools/call", { name: "delete_content", arguments: { path: "content/pages/en/about.md" } });
    expect(write.status).toBe(403);
    expect(write.headers.get("www-authenticate")).toContain("content.write");
    const batch = await browser.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}` }, body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "describe_site_system" } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "publish", arguments: {} } },
    ]) });
    expect(batch.status).toBe(403);
    expect(batch.headers.get("www-authenticate")).toContain("site.publish");
  });

  it("keeps publish separate from content write and rejects unclassified/prototype tools", async () => {
    const { browser, tokens } = await connected("content.read content.write offline_access");
    expect((await call(browser, tokens.access_token, "tools/call", { name: "publish" })).status).toBe(403);
    expect((await call(browser, tokens.access_token, "tools/call", { name: "constructor" })).status).toBe(400);
    expect((await call(browser, tokens.access_token, "tools/call", { name: "future_tool" })).status).toBe(400);
  });

  it("rejects nonowners before creating any OAuth grant", async () => {
    const browser = new Browser();
    const auth = await authorize(browser);
    const state = await start(browser, auth);
    const response = await finish(browser, state, "editor");
    expect(response.status).toBe(403);
    const grants = await env.OAUTH_KV.list({ prefix: "grant:" });
    expect(grants.keys).toHaveLength(0);
  });

  it("rejects stolen upstream state and polling too early without calling GitHub", async () => {
    const browser = new Browser();
    const auth = await authorize(browser);
    const state = await start(browser, auth);
    expect((await new Browser().post("/device", { state })).status).toBe(400);
    const early = await browser.post("/device", { state });
    expect(early.status).toBe(200);
    const next = hidden(await early.text(), "state");
    expect(next).not.toBe(state);
    expect((await browser.post("/device", { state })).status).toBe(400);
    expect((await browser.post("/device", { state: next, decision: "deny" })).status).toBe(302);
  });

  it("rotates pending device state, honors slow_down and keeps a fixed consent expiry", async () => {
    const browser = new Browser();
    const auth = await authorize(browser);
    const state = await start(browser, auth);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 6000);
    fetchMock.get("https://github.com").intercept({ path: "/login/oauth/access_token", method: "POST" }).reply(200, { error: "slow_down" });
    const pending = await browser.post("/device", { state });
    expect(pending.status).toBe(200);
    const html = await pending.text();
    expect(html).toContain("10000");
    const next = hidden(html, "state");
    clock.mockReturnValue(now + 11_000);
    const early = await browser.post("/device", { state: next });
    expect(early.status).toBe(200);
    // Obtain the new bound state after the early poll, then expire the overall flow.
    const newest = hidden(await early.text(), "state");
    clock.mockReturnValue(now + 601_000);
    const expired = await browser.post("/device", { state: newest });
    expect(expired.status).toBe(302);
    expect(new URL(expired.headers.get("Location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("binds PKCE, single-use code and the exact resource, rotates and revokes refresh tokens", async () => {
    const { browser, auth, code, tokens } = await connected();
    const wrong = await browser.post("/oauth/token", { grant_type: "refresh_token", client_id: auth.clientId, refresh_token: tokens.refresh_token, resource: "https://attacker.example/mcp" });
    expect(wrong.status).toBe(400);
    const refreshed = await browser.post("/oauth/token", { grant_type: "refresh_token", client_id: auth.clientId, refresh_token: tokens.refresh_token, resource: RESOURCE });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    const replacement = await refreshed.json() as { access_token: string; refresh_token: string };
    expect(replacement.refresh_token).not.toBe(tokens.refresh_token);
    expect((await call(browser, replacement.access_token, "ping")).status).toBe(200);
    const revoked = await browser.post("/oauth/token", { action: "revoke", token: replacement.refresh_token, client_id: auth.clientId });
    expect(revoked.status).toBe(200);
    expect((await call(browser, replacement.access_token, "ping")).status).toBe(401);
  });

  it("revokes a grant when its authorization code is replayed", async () => {
    const { browser, auth, code, tokens } = await connected();
    expect((await exchange(browser, auth, code)).status).toBe(400);
    expect((await call(browser, tokens.access_token, "ping")).status).toBe(401);
  });

  it("does not issue refresh tokens without offline consent", async () => {
    const { tokens } = await connected("content.read");
    expect(tokens.refresh_token).toBeUndefined();
  });

  it("rechecks removed GitHub access on existing OAuth tokens after cache expires", async () => {
    const { browser, tokens } = await connected();
    resetIdentityCache();
    fetchMock.get("https://api.github.com").intercept({ path: "/user" }).reply(200, { login: "tenant-owner" });
    fetchMock.get("https://api.github.com").intercept({ path: REPO_PATH }).reply(404, {});
    expect((await call(browser, tokens.access_token, "ping")).status).toBe(403);
  });

  it("challenges revoked GitHub credentials with OAuth reconnection rather than pasted tokens", async () => {
    const { browser, tokens } = await connected();
    resetIdentityCache();
    fetchMock.get("https://api.github.com").intercept({ path: "/user" }).reply(401, {});
    fetchMock.get("https://api.github.com").intercept({ path: REPO_PATH }).reply(401, {});
    const response = await call(browser, tokens.access_token, "ping");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
    expect(await response.text()).not.toContain("paste");
  });

  it("bounds chunked request bodies before MCP execution and rejects alternate hosts", async () => {
    const { browser, tokens } = await connected();
    const oversized = await browser.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}` }, body: "x".repeat(2 * 1024 * 1024 + 1) });
    expect(oversized.status).toBe(413);
    expect((await browser.request("/oauth/register", { method: "POST", body: "x".repeat(16385) })).status).toBe(413);
    const response = await worker.fetch(new Request("https://alias.example/.well-known/oauth-authorization-server"), env, createExecutionContext());
    expect(response.status).toBe(421);
  });
});
