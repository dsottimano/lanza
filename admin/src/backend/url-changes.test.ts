import { afterEach, describe, expect, it, vi } from "vitest";
import { movedRedirects, saveUrlChange, type UrlSave } from "./url-changes";
import { GitHubClient } from "./github";
import { site } from "./site";
import { ruleError } from "./redirect-rules";

const rule = (from: string, to: string) => ({ from, to, status: 301 });
afterEach(() => vi.unstubAllGlobals());
describe("permanent URL changes", () => {
  it("moves a localized homepage and retains both forms of incoming paths", () => {
    expect(movedRedirects([rule("/old-home", "/es/")], "/es/", "/es/inicio/")).toEqual([
      rule("/es/", "/es/inicio/"), rule("/es", "/es/inicio/"), rule("/old-home", "/es/inicio/"),
    ]);
    expect(ruleError(rule("/", "/welcome/"))).toBeNull();
    for (const from of ["/*", "/ad*", "/:path", "/admin", "/admin/api"]) expect(ruleError(rule(from, "/welcome/"))).not.toBeNull();
  });
  it("collapses repeated moves and allows returning to a previous URL without a loop", () => {
    const first = movedRedirects([], "/", "/welcome/");
    const second = movedRedirects(first, "/welcome/", "/hello/");
    expect(second.find(r => r.from === "/")?.to).toBe("/hello/");
    const back = movedRedirects(second, "/hello/", "/");
    expect(back.every(r => r.from !== "/" && r.to === "/")).toBe(true);
  });
  it("rejects destinations already redirected elsewhere or covered by a pattern", () => {
    expect(() => movedRedirects([rule("/taken", "/elsewhere/")], "/old/", "/taken/")).toThrow("already has a redirect");
    expect(() => movedRedirects([rule("/posts/*", "/elsewhere/")], "/old/", "/posts/new/")).toThrow("pattern");
  });
});

function fixture() {
  site.defaultLocale = "en";
  site.urls = {};
  const change: UrlSave = { collection: "pages", locale: "es", stem: "home", slug: "inicio", previousSlug: "", path: "content/pages/es/home.md", sha: "entry", data: { title: "Inicio" }, body: "<p>Hola</p>" };
  const client = {
    workingHead: vi.fn().mockResolvedValue("head"),
    loadJson: vi.fn(async (path: string) => ({ sha: path, data: path === "data/site.json" ? { defaultLocale: "en", locales: [{ code: "en" }, { code: "es" }], retained: true } : path === "data/schema.json" ? [] : { redirects: [rule("/old-es", "/es/")], retained: true } })),
    getTree: vi.fn().mockResolvedValue({ tree: [{ path: change.path }], truncated: false }),
    commitChecked: vi.fn().mockResolvedValue({ [change.path]: "new-entry", "data/site.json": "new-site" }),
  };
  return { client, change, save: () => saveUrlChange(client as unknown as GitHubClient, change) };
}

describe("route transaction", () => {
  it("commits content, language URL and redirects together while retaining settings and filename", async () => {
    const { client, change, save } = fixture();
    await expect(save()).resolves.toBe("new-entry");
    const [head, files] = client.commitChecked.mock.calls[0] as unknown as [string, { path: string; text: string }[]];
    expect(head).toBe("head");
    expect(files.map(f => f.path)).toEqual([change.path, "data/site.json", "data/redirects.json"]);
    expect(JSON.parse(files[1].text)).toMatchObject({ retained: true, urls: { "pages/es/home": "inicio" } });
    expect(JSON.parse(files[2].text)).toMatchObject({ retained: true, redirects: expect.arrayContaining([rule("/es/", "/es/inicio/")]) });
    expect(site.urls["pages/en/home"]).toBeUndefined();
  });
  it("rejects occupied, reserved and custom collection URLs without writing", async () => {
    for (const slug of ["taken", "admin", "es", "events"]) {
      const { client, change, save } = fixture();
      change.slug = slug;
      client.getTree.mockResolvedValue({ tree: [{ path: "content/pages/es/taken.md" }], truncated: false });
      const load = client.loadJson.getMockImplementation()!;
      client.loadJson.mockImplementation(async path => path === "data/schema.json" ? { sha: "schema", data: [{ route: { base: "events" } }] } as any : load(path));
      await expect(save()).rejects.toThrow();
      expect(client.commitChecked).not.toHaveBeenCalled();
    }
  });
  it("does not change local URL settings after a failed commit", async () => {
    const { client, save } = fixture();
    client.commitChecked.mockRejectedValue(new Error("conflict"));
    await expect(save()).rejects.toThrow("conflict");
    expect(site.urls).toEqual({});
  });
});

describe("GitHub atomic writes", () => {
  it("rejects stale content before creating any blobs or commits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sha: "agent-edited" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new GitHubClient().commitChecked("head", [{ path: "content/pages/es/home.md", sha: "old", text: "writing" }], "move")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("ref=head");
  });
  it("uses the validated parent and never forces a concurrent branch move", async () => {
    const calls: { url: string; body: any; method: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body, method: init.method ?? "GET" });
      let result: unknown = { sha: "new" };
      if (url.includes("/contents/")) result = { sha: "base" };
      // The branch moves after the preflight; GitHub rejects the final update.
      if (url.includes("/git/ref/")) result = { object: { sha: "head" } };
      if (url.includes("/git/commits/head")) result = { tree: { sha: "tree-base" } };
      return new Response(JSON.stringify(result), { status: init.method === "PATCH" ? 422 : 200 });
    }));
    await expect(new GitHubClient().commitChecked("head", [{ path: "content/pages/es/home.md", sha: "base", text: "new writing" }], "move")).rejects.toMatchObject({ status: 422 });
    expect(calls.find(c => c.url.endsWith("/git/commits") && c.method === "POST")?.body.parents).toEqual(["head"]);
    expect(calls.find(c => c.method === "PATCH")?.body.force).not.toBe(true);
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
  });
  it("does not retry an ordinary content save over another editor's changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"message":"conflict"}', { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new GitHubClient().saveEntry("content/pages/es/home.md", { title: "Inicio" }, "hello", "save", "old")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
