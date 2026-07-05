import { describe, it, expect } from "vitest";
import { pickSiteUrl } from "./useHealthChecks";
import type { PagesProject } from "../backend/cloudflare";

// Minimal PagesProject stub — only the fields pickSiteUrl reads.
function project(domains: string[], subdomain = "acme.pages.dev"): PagesProject {
  return { name: "acme", subdomain, domains, deployment_configs: {} };
}

describe("pickSiteUrl — derive the site URL from a Pages project", () => {
  it("prefers an attached custom domain over the pages.dev", () => {
    expect(pickSiteUrl(project(["acme.pages.dev", "lanzacms.com"]))).toBe("https://lanzacms.com");
  });

  it("falls back to the project subdomain when there's no custom domain", () => {
    expect(pickSiteUrl(project(["acme.pages.dev"]))).toBe("https://acme.pages.dev");
  });

  it("uses the subdomain when domains is empty", () => {
    expect(pickSiteUrl(project([], "acme.pages.dev"))).toBe("https://acme.pages.dev");
  });

  it("normalizes a bare host to an https origin (no scheme, no trailing path)", () => {
    expect(pickSiteUrl(project(["lanzacms.com/"]))).toBe("https://lanzacms.com");
  });

  it("returns null when there's nothing usable", () => {
    expect(pickSiteUrl(project([], ""))).toBeNull();
  });
});
