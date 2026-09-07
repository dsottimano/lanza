import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest, MAX_MCP_BODY_BYTES } from "../api/mcp.ts";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
let serial = 0;
function request(body, extra = {}) {
  return new Request("https://example.test/api/mcp", { method: "POST", body,
    headers: { Authorization: `Bearer test-transport-${++serial}`, ...extra },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
function github(role = "owner") {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.ok(!init?.method || init.method === "GET", "transport refusal must not write");
    if (String(url).endsWith("/user")) return Response.json({ login: "test" });
    if (String(url).includes("/repos/")) return Response.json({ permissions: { admin: role === "owner", push: true, pull: true } });
    throw new Error(`Unexpected fetch ${url}`);
  };
  return calls;
}
test("MCP refuses declared oversized bodies before upstream calls", async () => {
  const calls = github();
  const response = await onRequest({ request: request("{}", { "content-length": String(MAX_MCP_BODY_BYTES + 1) }) });
  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});
test("MCP enforces streaming body limit even with no Content-Length", async () => {
  github();
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } });
  const response = await onRequest({ request: request(body) });
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
});
test("MCP rejects empty and oversized batches; small requests still work", async () => {
  github();
  for (const body of [[], Array.from({ length: 21 }, () => ({ jsonrpc: "2.0", id: 1, method: "ping" }))]) {
    assert.equal((await onRequest({ request: request(JSON.stringify(body)) })).status, 400);
  }
  const response = await onRequest({ request: request('{"jsonrpc":"2.0","id":1,"method":"ping"}') });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result, {});
});
test("MCP refuses an editor before processing a tool call", async () => {
  github("editor");
  const response = await onRequest({ request: request('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"publish"}}') });
  assert.equal(response.status, 403);
});
