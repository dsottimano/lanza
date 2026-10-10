import { describe, it, expect, vi, afterEach } from "vitest";
import { pickSiteUrl, useHealthChecks } from "./useHealthChecks";
import { CloudflareClient, type PagesProject } from "../backend/cloudflare";

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


describe("production deployment health", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function health(environment: string, stage: string, status: string) {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input, 'https://cms.test');
      let result: unknown = [];
      if (url.pathname.endsWith('/verify')) result = { id: 'token', status: 'active' };
      else if (url.pathname.endsWith('/projects/self')) result = project(['acme.pages.dev']);
      else if (url.pathname.endsWith('/deployments')) result = [{ id: 'test', environment, url: 'https://deploy.pages.dev', created_on: new Date().toISOString(), latest_stage: { name: stage, status } }];
      else if (url.pathname.endsWith('/buckets')) result = { buckets: [] };
      return new Response(JSON.stringify({ success: true, result }));
    });
    vi.stubGlobal('fetch', fetcher);
    const checks = useHealthChecks({ getIdentity: async () => ({ login: 'owner' }) } as never);
    await checks.refreshAll();
    const request = fetcher.mock.calls.map(([input]) => new URL(input, 'https://cms.test')).find(url => url.pathname.endsWith('/deployments'))!;
    expect(request.searchParams.get('env')).toBe('production');
    expect(request.searchParams.get('per_page')).toBe('1');
    return checks.pagesCard;
  }

  it('never calls a preview deployment live', async () => {
    const card = await health('preview', 'deploy', 'success');
    expect(card.deployStatus).toBe('unknown');
    expect(card.deployUrl).toBeNull();
  });
  it('reports a completed production deployment as live', async () => {
    expect((await health('production', 'deploy', 'success')).deployStatus).toBe('live');
  });
  it('does not treat a completed build stage as a deployed site', async () => {
    expect((await health('production', 'build', 'success')).deployStatus).toBe('building');
  });
  it.each(['failure', 'canceled', 'skipped'])('reports %s rather than live', async status => {
    expect((await health('production', 'deploy', status)).deployStatus).toBe('failed');
  });
  it('keeps unfiltered deployment listing available to other callers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, result: [] })));
    vi.stubGlobal('fetch', fetcher);
    await new CloudflareClient().listDeployments();
    expect(fetcher).toHaveBeenCalledWith('/admin/api/cf/accounts/self/pages/projects/self/deployments', expect.anything());
  });
});
