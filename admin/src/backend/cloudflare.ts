// All Cloudflare-API traffic goes through our own proxy (prod: Pages Function at
// functions/admin/api/cf/[[path]].ts; dev: the vite middleware in vite.config.ts).
// The proxy injects the token server-side and substitutes the `self` placeholders
// (account + Pages project), so the token, account ID and project name never touch
// the browser. This client always sends `self` for both — the proxy fills in the
// real values.
const API = "/admin/api/cf";
const ACCOUNT = "accounts/self";
const PROJECT = `${ACCOUNT}/pages/projects/self`;

// ── Types (only the fields the Site Health + deploy-status UIs need) ──

export interface KvNamespace {
  id: string;
  title: string;
}

export interface D1Database {
  uuid: string;
  name: string;
}

export interface R2Bucket {
  name: string;
  creation_date?: string;
}

export interface TokenVerification {
  id: string;
  status: string; // "active" when the token is valid
}

/** One stage of a Pages deployment's build/deploy pipeline. */
export interface DeploymentStage {
  name: string; // e.g. "queued", "build", "deploy"
  status: string; // "success" | "active" | "idle" | "failure" | "canceled"
  started_on: string | null;
  ended_on: string | null;
}

export interface Deployment {
  id: string;
  url: string; // live URL for this deployment
  environment: string; // "production" | "preview"
  created_on: string;
  latest_stage: DeploymentStage | null;
}

// deployment_configs holds the Pages Functions bindings per environment. Typed
// loosely: the UI reads/writes binding maps (kv_namespaces, d1_databases,
// r2_buckets, …) whose exact members vary — only the envelope is pinned here.
export interface PagesDeploymentConfig {
  [key: string]: unknown;
}

export interface PagesProject {
  name: string;
  subdomain: string;
  domains: string[];
  deployment_configs: {
    production?: PagesDeploymentConfig;
    preview?: PagesDeploymentConfig;
  };
}

// Cloudflare's standard response envelope.
interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors: { code: number; message: string }[];
}

export class CloudflareError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Thrown when the proxy reports the server secrets aren't set (503
// {configured:false,…}). The UI catches this to render a "not configured, here's
// how to fix it" state instead of a generic error.
export class NotConfiguredError extends Error {
  constructor(public missing: string[]) {
    super(`Cloudflare proxy not configured (missing: ${missing.join(", ")}).`);
  }
}

export class CloudflareClient {
  // No token held client-side — the proxy injects it server-side.

  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      // Never serve API reads from the browser cache — diagnostics must reflect
      // the live state of the account, not a stale snapshot.
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });

    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      // The proxy's distinctive "not configured" 503 — surface as its own type.
      const p = parsed as { configured?: boolean; missing?: string[] } | null;
      if (res.status === 503 && p && p.configured === false) {
        throw new NotConfiguredError(p.missing ?? []);
      }
      throw new CloudflareError(res.status, this.errorMessage(parsed, raw));
    }
    return parsed;
  }

  // Prefer Cloudflare's errors[] messages; fall back to a proxy `message`, then
  // the raw body.
  private errorMessage(parsed: unknown, raw: string): string {
    const p = parsed as {
      errors?: { message?: string }[];
      message?: string;
    } | null;
    const cf = p?.errors?.map((e) => e.message).filter(Boolean);
    if (cf && cf.length) return cf.join("; ");
    if (p && typeof p.message === "string") return p.message;
    return raw;
  }

  // Unwrap the {success, result, errors} envelope, turning success:false into a
  // CloudflareError even on a 200 (the CF API sometimes does this).
  private unwrap<T>(body: unknown): T {
    const env = body as CfEnvelope<T> | null;
    if (!env || env.success !== true) {
      throw new CloudflareError(
        200,
        this.errorMessage(body, JSON.stringify(body)),
      );
    }
    return env.result;
  }

  private async get<T>(path: string): Promise<T> {
    return this.unwrap<T>(await this.req(path));
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.unwrap<T>(
      await this.req(path, { method: "POST", body: JSON.stringify(body) }),
    );
  }

  /** Validate the token; returns the verification result (status === "active"). */
  async verifyToken(): Promise<TokenVerification> {
    return this.get<TokenVerification>("/user/tokens/verify");
  }

  async listKvNamespaces(): Promise<KvNamespace[]> {
    return this.get<KvNamespace[]>(`/${ACCOUNT}/storage/kv/namespaces`);
  }

  async createKvNamespace(title: string): Promise<KvNamespace> {
    return this.post<KvNamespace>(`/${ACCOUNT}/storage/kv/namespaces`, { title });
  }

  async listD1Databases(): Promise<D1Database[]> {
    return this.get<D1Database[]>(`/${ACCOUNT}/d1/database`);
  }

  async createD1Database(name: string): Promise<D1Database> {
    return this.post<D1Database>(`/${ACCOUNT}/d1/database`, { name });
  }

  async listR2Buckets(): Promise<R2Bucket[]> {
    // R2 wraps its list under result.buckets, unlike the flat-array collections.
    const result = await this.get<{ buckets: R2Bucket[] }>(
      `/${ACCOUNT}/r2/buckets`,
    );
    return result.buckets ?? [];
  }

  async createR2Bucket(name: string): Promise<R2Bucket> {
    return this.post<R2Bucket>(`/${ACCOUNT}/r2/buckets`, { name });
  }

  async getPagesProject(): Promise<PagesProject> {
    return this.get<PagesProject>(`/${PROJECT}`);
  }

  /**
   * Update the Pages project. `patch` is typed loosely — the caller sends a
   * partial project, typically `{ deployment_configs: { production: { … } } }`
   * to add bindings. Returns the updated project.
   */
  async updatePagesProject(patch: Record<string, unknown>): Promise<PagesProject> {
    return this.unwrap<PagesProject>(
      await this.req(`/${PROJECT}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    );
  }

  /** List recent deployments, newest first. `limit` maps to CF's `per_page`. */
  async listDeployments(limit?: number): Promise<Deployment[]> {
    const q = limit ? `?per_page=${limit}` : "";
    return this.get<Deployment[]>(`/${PROJECT}/deployments${q}`);
  }
}
