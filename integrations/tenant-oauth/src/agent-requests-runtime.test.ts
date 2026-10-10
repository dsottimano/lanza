import { afterEach, expect, it, vi } from "vitest";
import { ContentClient } from "../../../functions/_lib/lanza-content";

afterEach(() => vi.unstubAllGlobals());

it("private archive constructs a real workerd Request with supported options", async () => {
  const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // This is workerd's native Request, not Node's. Unlike Node, Workers rejects
    // redirect:error before performing any I/O. Validate the actual outgoing init.
    const request = new Request(input, init);
    expect(request.url).toBe("https://api.github.com/repos/example/private-site");
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("Cache-Control")).toBe("no-cache");
    return Response.json({ private: true, permissions: { admin: true } });
  });
  vi.stubGlobal("fetch", upstream);
  const client = new ContentClient({ owner: "example", name: "private-site" }, "fixture-token");
  await expect(client.agentRequestArchive("GET", "")).resolves.toEqual({ private: true, permissions: { admin: true } });
  expect(upstream).toHaveBeenCalledTimes(1);
});

it("private archive rejects redirect responses without following or forwarding credentials", async () => {
  const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.redirect).toBe("manual");
    return new Response(null, { status: 302, headers: { Location: "https://untrusted.example/" } });
  });
  vi.stubGlobal("fetch", upstream);
  const client = new ContentClient({ owner: "example", name: "private-site" }, "fixture-token");
  await expect(client.agentRequestArchive("GET", "")).rejects.toMatchObject({ status: 302 });
  expect(upstream).toHaveBeenCalledTimes(1);
});
