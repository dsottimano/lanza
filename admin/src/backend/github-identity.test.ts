import { afterEach, expect, it, vi } from "vitest";
import { githubIdentity } from "../../dev/github-identity";

afterEach(() => vi.unstubAllGlobals());

it.each([
  [{ admin: true, push: true }, "owner"],
  [{ push: true }, "editor"],
  [{ pull: true }, "viewer"],
  [undefined, null],
])("returns the repository role for %j", async (permissions, role) => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ login: "alice" }))
    .mockResolvedValueOnce(Response.json({ permissions }));
  vi.stubGlobal("fetch", fetcher);
  const response = await githubIdentity("test-token", { owner: "team", name: "site" });
  expect(await response.json()).toEqual({ login: "alice", role, repo: "team/site" });
  expect(fetcher.mock.calls[1]![0]).toBe("https://api.github.com/repos/team/site");
});

it.each([401, 403, 404, 500])("preserves a failed repository lookup (%s) instead of granting ownership", async (status) => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ login: "alice" }))
    .mockResolvedValueOnce(Response.json({ message: "Unavailable" }, { status })));
  const response = await githubIdentity("test-token", { owner: "team", name: "site" });
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ message: "Unavailable" });
});
