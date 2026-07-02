// Site Health data layer. Runs the GitHub + Cloudflare diagnostics that the
// SiteHealthView renders, and performs the "Enable"/"Connect" provisioning
// actions. Kept out of the view so the component stays presentational.
//
// It owns its own CloudflareClient (the view only receives a GitHubClient); both
// clients talk to the server-side proxies, so nothing here holds a token.
import { reactive, ref } from "vue";
import { GitHubClient, GitHubError } from "../backend/github";
import {
  CloudflareClient,
  CloudflareError,
  NotConfiguredError,
  type Deployment,
  type PagesProject,
  type PagesDeploymentConfig,
} from "../backend/cloudflare";

// ── Card view-models ──────────────────────────────────────────────────────

/** GitHub connection card. */
export interface GithubCard {
  loading: boolean;
  state: "ok" | "error";
  login: string | null;
  summary: string;
  detail: string; // technical detail behind the "how to fix" expander
  authIssue: boolean; // 401/403/404 → token missing/expired hint
}

/** Cloudflare API-token card. */
export interface CfApiCard {
  loading: boolean;
  state: "ok" | "notConfigured" | "error";
  summary: string;
  detail: string;
  missing: string[]; // which server vars are unset (NotConfiguredError)
}

/** Pages project + latest deployment card. */
export interface PagesCard {
  loading: boolean;
  state: "ok" | "notConfigured" | "error";
  summary: string;
  detail: string;
  projectName: string | null;
  productionBranch: string | null;
  deployStatus: "live" | "building" | "failed" | "unknown" | null;
  deployWhen: string | null; // relative time, e.g. "3 minutes ago"
  deployUrl: string | null;
}

export type ServiceKind = "kv" | "d1" | "r2";

/**
 * A storage service (KV / D1 / R2). `state` is the combined "exists on the
 * account" × "bound to this project" fact:
 *   notConfigured — the Cloudflare connection isn't set up yet
 *   off           — no resource exists → offer [Enable]
 *   found         — resource exists but isn't bound → offer [Connect]
 *   connected     — bound to the project (green)
 *   error         — a check failed
 */
export interface ServiceCard {
  loading: boolean;
  busy: boolean; // an Enable/Connect action is running
  state: "notConfigured" | "off" | "found" | "connected" | "error";
  bindingName: string; // the env-binding name once connected (KV / DB / MEDIA)
  resourceName: string | null; // the actual resource's name/title
  resourceId: string | null; // namespace id / database uuid / bucket name
  detail: string; // error detail, if any
}

// ── Static per-service config ─────────────────────────────────────────────

interface ServiceMeta {
  label: string;
  blurb: string;
  suffix: string; // resource name = `${project}-${suffix}`
  binding: string; // uppercase env-binding name
  mapKey: "kv_namespaces" | "d1_databases" | "r2_buckets";
}

export const SERVICE_META: Record<ServiceKind, ServiceMeta> = {
  kv: {
    label: "Key-value storage (KV)",
    blurb: "Fast lookups for small bits of data, like counters or settings.",
    suffix: "kv",
    binding: "KV",
    mapKey: "kv_namespaces",
  },
  d1: {
    label: "Database (D1)",
    blurb: "A SQL database for structured content such as listings or forms.",
    suffix: "db",
    binding: "DB",
    mapKey: "d1_databases",
  },
  r2: {
    label: "File storage (R2)",
    blurb: "Stores uploads and media — images, PDFs, downloads.",
    suffix: "media",
    binding: "MEDIA",
    mapKey: "r2_buckets",
  },
};

export const SERVICE_KINDS: ServiceKind[] = ["kv", "d1", "r2"];

// ── Helpers ───────────────────────────────────────────────────────────────

// The Pages project carries production_branch, which the shared PagesProject
// type doesn't model (the UI only needs it here) — read it through this.
type ProjectWithBranch = PagesProject & { production_branch?: string };

// A resource, normalized to the three fields the UI works in regardless of kind.
interface NormalizedResource {
  name: string; // matches against `${project}-${suffix}`
  id: string; // namespace id / uuid / bucket name
  entry: Record<string, string>; // the binding-map value for this resource
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = Math.max(secs, 0);
  for (const [step, name] of units) {
    if (value < step) {
      const n = Math.max(1, Math.round(value));
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
    value /= step;
  }
  return "just now";
}

// The binding map for one service in one environment (e.g. production's
// kv_namespaces). Missing → an empty map.
function bindingMap(
  config: PagesDeploymentConfig | undefined,
  mapKey: string,
): Record<string, unknown> {
  const map = config?.[mapKey];
  return map && typeof map === "object" ? (map as Record<string, unknown>) : {};
}

// ── Composable ────────────────────────────────────────────────────────────

export function useHealthChecks(github: GitHubClient) {
  const cf = new CloudflareClient();

  const githubCard = reactive<GithubCard>({
    loading: true,
    state: "ok",
    login: null,
    summary: "",
    detail: "",
    authIssue: false,
  });

  const cfApiCard = reactive<CfApiCard>({
    loading: true,
    state: "ok",
    summary: "",
    detail: "",
    missing: [],
  });

  const pagesCard = reactive<PagesCard>({
    loading: true,
    state: "ok",
    summary: "",
    detail: "",
    projectName: null,
    productionBranch: null,
    deployStatus: null,
    deployWhen: null,
    deployUrl: null,
  });

  const services = reactive<Record<ServiceKind, ServiceCard>>({
    kv: freshService("kv"),
    d1: freshService("d1"),
    r2: freshService("r2"),
  });

  // Proxy reachability — set as a side effect of the checks (no extra requests).
  // null = not yet determined this run.
  const proxies = reactive<{ gh: boolean | null; cf: boolean | null }>({
    gh: null,
    cf: null,
  });

  const refreshing = ref(false);

  function freshService(kind: ServiceKind): ServiceCard {
    return {
      loading: true,
      busy: false,
      state: "off",
      bindingName: SERVICE_META[kind].binding,
      resourceName: null,
      resourceId: null,
      detail: "",
    };
  }

  // ── GitHub ──
  async function checkGithub(): Promise<void> {
    githubCard.loading = true;
    try {
      const login = await github.getLogin();
      proxies.gh = true;
      githubCard.state = "ok";
      githubCard.login = login;
      githubCard.summary = `Connected as ${login}`;
      githubCard.detail = "";
      githubCard.authIssue = false;
    } catch (e) {
      githubCard.state = "error";
      githubCard.login = null;
      if (e instanceof GitHubError) {
        proxies.gh = true; // the proxy answered (with an HTTP error)
        githubCard.authIssue =
          e.status === 401 || e.status === 403 || e.status === 404;
        githubCard.summary = githubCard.authIssue
          ? "Can't reach your content — the GitHub token looks missing or expired."
          : "GitHub isn't responding as expected.";
        githubCard.detail = `${e.status}: ${e.message}`;
      } else {
        proxies.gh = false; // never got a response (network / proxy down)
        githubCard.authIssue = false;
        githubCard.summary = "Couldn't reach the GitHub connection.";
        githubCard.detail = e instanceof Error ? e.message : String(e);
      }
    } finally {
      githubCard.loading = false;
    }
  }

  // ── Cloudflare (token + project + services), all sharing one project read ──
  async function checkCloudflare(): Promise<void> {
    setCfLoading(true);

    // 1. Token — decides which "not set up" vs "error" state everything gets.
    try {
      const v = await cf.verifyToken();
      proxies.cf = true;
      if (v.status === "active") {
        cfApiCard.state = "ok";
        cfApiCard.summary = "Cloudflare is connected and the token is valid.";
        cfApiCard.detail = `Token ${v.id} status: ${v.status}`;
        cfApiCard.missing = [];
      } else {
        cfApiCard.state = "error";
        cfApiCard.summary = `The Cloudflare token isn't active (status: ${v.status}).`;
        cfApiCard.detail = `Token ${v.id} status: ${v.status}`;
        cfApiCard.missing = [];
      }
    } catch (e) {
      if (e instanceof NotConfiguredError) {
        proxies.cf = true; // the proxy answered with its 503
        cfApiCard.state = "notConfigured";
        cfApiCard.missing = e.missing;
        cfApiCard.summary = "Not set up yet.";
        cfApiCard.detail = e.message;
        cascadeNotConfigured();
        setCfLoading(false);
        return;
      }
      proxies.cf = !(e instanceof TypeError); // TypeError == fetch never reached the proxy
      cfApiCard.state = "error";
      cfApiCard.summary = "Couldn't verify the Cloudflare connection.";
      cfApiCard.detail = describe(e);
      cfApiCard.missing = [];
      cascadeError(describe(e));
      setCfLoading(false);
      return;
    }

    // 2. Everything the token unlocks, in parallel — one project read is shared
    //    between the Pages card and the service cards.
    const [projectRes, deploysRes, kvRes, d1Res, r2Res] = await Promise.allSettled([
      cf.getPagesProject(),
      cf.listDeployments(1),
      cf.listKvNamespaces(),
      cf.listD1Databases(),
      cf.listR2Buckets(),
    ]);

    applyPagesCard(projectRes, deploysRes);

    const project =
      projectRes.status === "fulfilled" ? projectRes.value : null;
    applyService("kv", project, kvRes);
    applyService("d1", project, d1Res);
    applyService("r2", project, r2Res);

    setCfLoading(false);
  }

  function setCfLoading(v: boolean): void {
    cfApiCard.loading = v;
    pagesCard.loading = v;
    for (const k of SERVICE_KINDS) services[k].loading = v;
  }

  function cascadeNotConfigured(): void {
    pagesCard.state = "notConfigured";
    pagesCard.summary = "Set up the Cloudflare connection first.";
    for (const k of SERVICE_KINDS) {
      services[k].state = "notConfigured";
      services[k].resourceName = null;
      services[k].resourceId = null;
      services[k].detail = "";
    }
  }

  function cascadeError(detail: string): void {
    pagesCard.state = "error";
    pagesCard.summary = "Couldn't read the Cloudflare project.";
    pagesCard.detail = detail;
    for (const k of SERVICE_KINDS) {
      services[k].state = "error";
      services[k].detail = detail;
    }
  }

  function applyPagesCard(
    projectRes: PromiseSettledResult<PagesProject>,
    deploysRes: PromiseSettledResult<Deployment[]>,
  ): void {
    if (projectRes.status !== "fulfilled") {
      pagesCard.state = "error";
      pagesCard.summary = "Couldn't read your Pages project.";
      pagesCard.detail = describe(projectRes.reason);
      pagesCard.projectName = null;
      pagesCard.productionBranch = null;
      pagesCard.deployStatus = null;
      pagesCard.deployWhen = null;
      pagesCard.deployUrl = null;
      return;
    }

    const project = projectRes.value as ProjectWithBranch;
    pagesCard.state = "ok";
    pagesCard.projectName = project.name;
    pagesCard.productionBranch = project.production_branch ?? null;
    pagesCard.summary = `Project "${project.name}" is set up.`;
    pagesCard.detail = "";

    const deploy =
      deploysRes.status === "fulfilled" ? deploysRes.value[0] : undefined;
    if (!deploy) {
      pagesCard.deployStatus = "unknown";
      pagesCard.deployWhen = null;
      pagesCard.deployUrl = null;
      if (deploysRes.status === "rejected") {
        pagesCard.detail = describe(deploysRes.reason);
      }
      return;
    }

    const stage = deploy.latest_stage;
    const status = stage?.status ?? "";
    pagesCard.deployWhen = relativeTime(deploy.created_on);
    pagesCard.deployUrl = deploy.url;
    if (status === "success") {
      pagesCard.deployStatus = "live";
      pagesCard.summary = `Live — last deploy ${pagesCard.deployWhen}.`;
    } else if (status === "failure" || status === "canceled") {
      pagesCard.deployStatus = "failed";
      pagesCard.summary = `Last deploy ${status} ${pagesCard.deployWhen}.`;
    } else {
      pagesCard.deployStatus = "building";
      pagesCard.summary = `Deploy in progress (${stage?.name ?? "working"})…`;
    }
    pagesCard.detail = stage
      ? `Stage "${stage.name}" — ${stage.status}. Deployment ${deploy.id}.`
      : `Deployment ${deploy.id}.`;
  }

  function applyService(
    kind: ServiceKind,
    project: PagesProject | null,
    listRes: PromiseSettledResult<unknown[]>,
  ): void {
    const card = services[kind];
    card.detail = "";

    if (!project) {
      card.state = "error";
      card.detail = "The Pages project couldn't be read.";
      return;
    }
    if (listRes.status !== "fulfilled") {
      card.state = "error";
      card.detail = describe(listRes.reason);
      return;
    }

    const meta = SERVICE_META[kind];
    const wantName = `${project.name}-${meta.suffix}`;
    const resource = normalizeMatch(kind, listRes.value, wantName);

    // Bound? — is there an entry under production's binding map at our name?
    const prod = project.deployment_configs.production;
    const bound = bindingMap(prod, meta.mapKey)[meta.binding];
    if (bound) {
      card.state = "connected";
      // Prefer the live resource's id; fall back to the bound value.
      card.resourceName = resource?.name ?? wantName;
      card.resourceId = resource?.id ?? boundId(kind, bound);
      return;
    }

    if (resource) {
      card.state = "found";
      card.resourceName = resource.name;
      card.resourceId = resource.id;
      return;
    }

    card.state = "off";
    card.resourceName = null;
    card.resourceId = null;
  }

  // ── Actions ──

  /** Off → create the resource named after the project, then bind it. */
  async function enable(kind: ServiceKind): Promise<void> {
    const card = services[kind];
    const meta = SERVICE_META[kind];
    const project = pagesCard.projectName;
    if (!project) return;
    const name = `${project}-${meta.suffix}`;
    card.busy = true;
    try {
      const resource = await createResource(kind, name);
      await bind(kind, resource);
      await checkCloudflare();
    } catch (e) {
      card.state = "error";
      card.detail = describe(e);
    } finally {
      card.busy = false;
    }
  }

  /** Found → bind the existing resource (no creation). */
  async function connect(kind: ServiceKind): Promise<void> {
    const card = services[kind];
    const meta = SERVICE_META[kind];
    const project = pagesCard.projectName;
    if (!project) return;
    const wantName = `${project}-${meta.suffix}`;
    card.busy = true;
    try {
      // Re-list to get the current resource id right before binding.
      const list = await listFor(kind);
      const resource = normalizeMatch(kind, list, wantName);
      if (!resource) throw new Error(`Couldn't find the ${meta.label} to connect.`);
      await bind(kind, resource);
      await checkCloudflare();
    } catch (e) {
      card.state = "error";
      card.detail = describe(e);
    } finally {
      card.busy = false;
    }
  }

  // Bind a resource into BOTH production and preview (if preview exists). The
  // merge is done client-side and the PATCH carries ONLY the one binding map we
  // touched, per environment — so existing bindings and env vars are preserved:
  //   { deployment_configs: { production: { <mapKey>: <merged map> }, … } }
  async function bind(kind: ServiceKind, resource: NormalizedResource): Promise<void> {
    const meta = SERVICE_META[kind];
    // Fresh read so the merge starts from the current bindings.
    const project = await cf.getPagesProject();
    const configs = project.deployment_configs;

    const deployment_configs: Record<string, unknown> = {};
    deployment_configs.production = {
      [meta.mapKey]: {
        ...bindingMap(configs.production, meta.mapKey),
        [meta.binding]: resource.entry,
      },
    };
    if (configs.preview) {
      deployment_configs.preview = {
        [meta.mapKey]: {
          ...bindingMap(configs.preview, meta.mapKey),
          [meta.binding]: resource.entry,
        },
      };
    }

    await cf.updatePagesProject({ deployment_configs });
  }

  async function createResource(
    kind: ServiceKind,
    name: string,
  ): Promise<NormalizedResource> {
    if (kind === "kv") {
      const ns = await cf.createKvNamespace(name);
      return { name: ns.title, id: ns.id, entry: { namespace_id: ns.id } };
    }
    if (kind === "d1") {
      const db = await cf.createD1Database(name);
      return { name: db.name, id: db.uuid, entry: { id: db.uuid } };
    }
    const bucket = await cf.createR2Bucket(name);
    return { name: bucket.name, id: bucket.name, entry: { name: bucket.name } };
  }

  async function listFor(kind: ServiceKind): Promise<unknown[]> {
    if (kind === "kv") return cf.listKvNamespaces();
    if (kind === "d1") return cf.listD1Databases();
    return cf.listR2Buckets();
  }

  // ── Orchestration ──
  async function refreshAll(): Promise<void> {
    refreshing.value = true;
    proxies.gh = null;
    proxies.cf = null;
    try {
      await Promise.all([checkGithub(), checkCloudflare()]);
    } finally {
      refreshing.value = false;
    }
  }

  return {
    githubCard,
    cfApiCard,
    pagesCard,
    services,
    proxies,
    refreshing,
    refreshAll,
    enable,
    connect,
  };
}

// ── Kind-specific normalization (kept as free functions, no `this`) ─────────

function normalizeMatch(
  kind: ServiceKind,
  list: unknown[],
  wantName: string,
): NormalizedResource | null {
  for (const raw of list) {
    const r = normalize(kind, raw);
    if (r && r.name === wantName) return r;
  }
  return null;
}

function normalize(kind: ServiceKind, raw: unknown): NormalizedResource | null {
  const o = raw as Record<string, unknown>;
  if (kind === "kv") {
    const id = String(o.id ?? "");
    const name = String(o.title ?? "");
    return id && name ? { name, id, entry: { namespace_id: id } } : null;
  }
  if (kind === "d1") {
    const id = String(o.uuid ?? "");
    const name = String(o.name ?? "");
    return id && name ? { name, id, entry: { id } } : null;
  }
  const name = String(o.name ?? "");
  return name ? { name, id: name, entry: { name } } : null;
}

function boundId(kind: ServiceKind, bound: unknown): string | null {
  const o = bound as Record<string, unknown>;
  if (kind === "kv") return o.namespace_id ? String(o.namespace_id) : null;
  if (kind === "d1") return o.id ? String(o.id) : null;
  return o.name ? String(o.name) : null;
}

function describe(e: unknown): string {
  if (e instanceof CloudflareError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
