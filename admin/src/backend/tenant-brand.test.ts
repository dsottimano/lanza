import { expect, it } from "vitest";
import { tenantBrand } from "./tenant-brand";
import { saveBrand } from "./brand";
import { GitHubError, type GitHubClient } from "./github";

function client(initial: Record<string, unknown> | Error) {
  let stored = initial;
  let sha = "a";
  return {
    loadJson: async () => { if (stored instanceof Error) { const e = stored; stored = { brand: {} }; throw e; } return { data: stored, sha }; },
    saveJson: async (_p: string, data: Record<string, unknown>) => { stored = data; sha = "b"; return sha; },
  } as unknown as GitHubClient;
}
it("same client: load, save a new brand, reopen shows the saved fonts", async () => {
  const c = client({ brand: { fonts: { heading: "jost", body: "jost" } } });
  expect((await tenantBrand(c))?.styleVars).toContain("Jost");
  await saveBrand(c, { fonts: { heading: "playfair-display", body: "system-serif" } } as Parameters<typeof saveBrand>[1], "a");
  const reopened = await tenantBrand(c);
  expect(reopened?.styleVars).toContain("Playfair Display");
  expect(reopened?.styleVars).toMatch(/--font-prose:Georgia/);
});
it("a failed load is not cached", async () => {
  const c = client(new GitHubError(503, "Unavailable"));
  expect(await tenantBrand(c)).toBeNull();
  expect(await tenantBrand(c)).not.toBeNull();
});
