// Lanza CMS — MCP protocol + tool definitions (transport-agnostic).
//
// This module owns the JSON-RPC dispatch and the tool surface. It takes a
// ContentClient (already bound to a repo + token) so it holds NO repo identity and
// NO Workers/Node globals beyond fetch-via-client — which keeps it unit-testable
// (node --experimental-strip-types) and reusable. The transport + auth wrapper lives
// in functions/api/mcp.ts.
//
// Tools mirror the Vue CMS (admin/src/backend/github.ts): every write lands on the
// `staging` branch; `publish` merges staging→main to go live.
import { ContentClient, GitHubError, slugify, assertSafePath } from "./lanza-content";
import { BRANCH, WORKING_BRANCH } from "./gh-proxy";

export const SERVER_INFO = { name: "lanza-cms", title: "Lanza CMS", version: "0.1.0" };
export const SUPPORTED_PROTOCOL = "2025-06-18";

// Where an agent can review a change before publishing.
//
// Every write lands on `staging` and nothing is public until publish, so an agent
// that can't name the staging URL can't offer a review step — each client
// otherwise re-derives Cloudflare's branch-alias convention by hand, which breaks
// silently the day a branch is renamed.
//
// This module holds no repo identity by design (see the header), and the staging
// name is derived from exactly that — so the TRANSPORT resolves it and passes it in.
// See functions/_lib/pages-project.ts.
export interface SiteContext {
  /** Origin this request arrived on, or null when the transport can't say. */
  origin: string | null;
  /** Reviewable staging URL, or null when it can't be named. */
  stagingUrl: string | null;
}

const NO_SITE: SiteContext = { origin: null, stagingUrl: null };

// What every write tool says afterwards. Two facts an agent cannot infer: WHERE the
// change can be seen, and that it will NOT be there yet. A Pages build takes 4-6
// minutes, and checking inside that window and reading "unchanged" as "broken" has
// produced two false bug hunts in this codebase — both by agents, not users. Saying
// it in the response is cheaper than either of them was.
function stagedNote(site: SiteContext): { note: string; reviewUrl?: string } {
  const staging = site.stagingUrl;
  if (!staging) {
    return { note: "Staged, not yet public. Call publish to make it live." };
  }
  return {
    note:
      "Staged, not yet public. Call publish to make it live. Review it first at reviewUrl — " +
      "a Cloudflare build takes about 4-6 minutes, so the page will still show the old " +
      "content until then. That delay is normal and is not a failed write.",
    reviewUrl: staging,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions. `inputSchema` is JSON Schema (hand-written — no MCP SDK in the
// Workers runtime). Descriptions are the agent's only contract, so they carry the
// staging/publish and draft semantics explicitly.
// ---------------------------------------------------------------------------

// `site` is resolved by the transport. Only get_site and the write tools use it;
// tools that don't need it just declare two params, which still satisfies this
// signature.
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(
    args: Record<string, unknown>,
    client: ContentClient,
    site: SiteContext,
  ): Promise<unknown>;
}

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const str = (description: string) => ({ type: "string", description });

// Memoized per ContentClient, exactly like getCollections below and for the same
// reason: resolveLocale calls this on EVERY write, so without it each create/update
// paid an extra data/site.json fetch (up to two GitHub subrequests) on top of the
// schema read it already does.
const siteCache = new WeakMap<ContentClient, Promise<SiteFile>>();

interface SiteFile {
  defaultLocale: string;
  locales: string[];
}

function readSiteFile(client: ContentClient): Promise<SiteFile> {
  const cached = siteCache.get(client);
  if (cached) return cached;
  const p = (async () => {
    const raw = await client.readRaw("data/site.json");
    const site = raw
      ? (JSON.parse(raw) as { defaultLocale?: string; locales?: Array<{ code: string }> })
      : {};
    return {
      defaultLocale: site.defaultLocale ?? "en",
      locales: (site.locales ?? []).map((l) => l.code),
    };
  })();
  siteCache.set(client, p);
  return p;
}

// `site` defaults to empty so the locale-safety path (resolveLocale) can ask for
// locales without caring about the transport — URLs are not part of that answer.
async function getSite(
  client: ContentClient,
  site_: SiteContext = NO_SITE,
): Promise<{
  defaultLocale: string;
  locales: string[];
  liveUrl: string | null;
  stagingUrl: string | null;
  productionBranch: string;
  workingBranch: string;
}> {
  const site = await readSiteFile(client);
  return {
    defaultLocale: site.defaultLocale,
    locales: site.locales,
    liveUrl: site_.origin,
    stagingUrl: site_.stagingUrl,
    productionBranch: BRANCH,
    workingBranch: WORKING_BRANCH,
  };
}

interface CollectionDef {
  name: string;
  folder: string;
  localized?: boolean;
  body?: string;
  kind?: string;
}

// Memoized per ContentClient. functions/api/mcp.ts builds a fresh client per
// request, so this lives exactly one request — long enough that path-confining
// every entry op doesn't re-fetch schema.json each time (each readRaw is up to
// two GitHub subrequests, against a 50-per-request ceiling; CLAUDE.md Rule 3).
const collectionsCache = new WeakMap<ContentClient, Promise<CollectionDef[]>>();

// Entries live under `content/`. Nothing else is a content folder.
//
// This exists because `create_content` does NOT go through assertEntryPath — it
// BUILDS its path (`${entryFolder(col, locale)}/${slug}.md`) rather than checking one,
// so the only guard on it was assertSafePath's structural test. That made
// `data/schema.json` a security boundary: a collection declaring
// `folder: "frontend/pages"` or `".github/workflows"` turned "create an entry" into
// "write a file there". The forced `.md` suffix bounded the damage (Actions needs
// `.yml`), but the schema file is writable through /admin/api/gh and the CMS's
// content-type editor, so it should not be load-bearing for confinement at all.
//
// Dropping a hostile collection here rather than throwing is deliberate: a malformed
// or hostile schema should make the collection INVISIBLE (create/read/update/delete
// all resolve it by name and 404), not break every other collection on the site.
const CONTENT_ROOT = "content/";

function isContentFolder(folder: string): boolean {
  const f = folder.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!f || f.includes("..") || f.includes("\\") || f.includes("%")) return false;
  return `${f}/`.startsWith(CONTENT_ROOT);
}

async function getCollections(client: ContentClient): Promise<CollectionDef[]> {
  const cached = collectionsCache.get(client);
  if (cached) return cached;
  const pending = (async () => {
    const raw = await client.readRaw("data/schema.json");
    if (!raw) throw new GitHubError(404, "This site has no data/schema.json — it may not be a Lanza site.");
    // schema.json is a bare array of collections — the shape the CMS writes
    // (admin/src/backend/schema.ts) and Astro's generator reads. Not an object.
    const schema = JSON.parse(raw) as unknown;
    if (!Array.isArray(schema)) {
      throw new GitHubError(500, "data/schema.json is not a collection array — this site's content model is malformed.");
    }
    // `kind: "files"` collections (Settings) are singleton JSON files, not entry
    // folders. They have no `folder`, and the MCP server does not edit them.
    return (schema as CollectionDef[])
      .filter((c) => typeof c.folder === "string" && c.folder !== "")
      .filter((c) => isContentFolder(c.folder));
  })();
  // Don't cache a rejection — a transient GitHub error would poison the request.
  pending.catch(() => collectionsCache.delete(client));
  collectionsCache.set(client, pending);
  return pending;
}

async function resolveCollection(client: ContentClient, name: string): Promise<CollectionDef> {
  const col = (await getCollections(client)).find((c) => c.name === name);
  if (!col) throw new GitHubError(404, `Unknown collection "${name}". Call list_collections to see valid names.`);
  return col;
}

// Folder that holds a collection's entries for a given locale (localized collections
// nest one subfolder per locale — matches the CMS's entryFolder()).
function entryFolder(col: CollectionDef, locale: string): string {
  return col.localized ? `${col.folder}/${locale}` : col.folder;
}

// A locale code is interpolated straight into a write path, so it is untrusted
// input, not a label — it must be a locale this site actually declares. Without
// this, `locale: "../../.github/workflows"` writes CI config.
async function resolveLocale(client: ContentClient, raw: unknown): Promise<string> {
  // readSiteFile, not getSite: this path only needs locales, and it's memoized.
  const site = await readSiteFile(client);
  if (raw === undefined || raw === null || raw === "") return site.defaultLocale;
  const locale = String(raw);
  const known = site.locales.length ? site.locales : [site.defaultLocale];
  if (!known.includes(locale)) {
    throw new GitHubError(
      400,
      `Unknown locale "${locale}". This site declares: ${known.join(", ")}. Call get_site to check.`,
    );
  }
  return locale;
}

// The entry tools take a repo path from the agent. Confine it to a folder some
// collection actually owns — otherwise "update an entry" is whole-repo write, and
// lanza.config.json (which decides who owns /admin), .github/workflows/* and
// astro.config.mjs are all in range. assertSafePath has already ruled out
// traversal by the time this runs; this decides *where* a path may point.
async function assertEntryPath(client: ContentClient, path: string): Promise<string> {
  assertSafePath(path);
  if (!path.endsWith(".md")) {
    throw new GitHubError(400, `Refusing "${path}": entries are .md files.`);
  }
  const folders = (await getCollections(client)).map((c) => c.folder.replace(/\/+$/, ""));
  if (!folders.some((f) => f && path.startsWith(`${f}/`))) {
    throw new GitHubError(
      403,
      `Refusing "${path}": it is outside every content collection (${folders.join(", ")}). ` +
        "The MCP server may only edit content entries.",
    );
  }
  return path;
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_site",
    description:
      "Get this site's locales, default locale, and URLs. Call first — locale codes here are the ones the other tools accept. `stagingUrl` is where unpublished changes can be reviewed before calling publish; it is null when the site is on a custom domain, where the staging alias can't be derived.",
    inputSchema: obj({}),
    run: (_args, client, site) => getSite(client, site),
  },
  {
    name: "list_collections",
    description:
      "List the content collections (e.g. posts, pages) with their folder, whether they are localized, and whether they have a rich HTML body.",
    inputSchema: obj({}),
    run: async (_args, client) =>
      (await getCollections(client)).map((c) => ({
        name: c.name,
        folder: c.folder,
        localized: !!c.localized,
        body: c.body ?? "none",
      })),
  },
  {
    name: "get_schema",
    description:
      "Return the full content model (data/schema.json): every collection and the frontmatter fields it expects. Use this to know which fields to set when creating or updating an entry.",
    inputSchema: obj({}),
    run: async (_args, client) => {
      const raw = await client.readRaw("data/schema.json");
      if (!raw) throw new GitHubError(404, "No data/schema.json found on this site.");
      return JSON.parse(raw);
    },
  },
  {
    name: "list_content",
    description:
      "List entries in a collection. For a localized collection pass a locale (defaults to the site's default locale). Returns file paths — pass a path to read_content, update_content, or delete_content.",
    inputSchema: obj(
      {
        collection: str("Collection name, e.g. 'posts' or 'pages' (see list_collections)."),
        locale: str("Locale code for localized collections, e.g. 'en'. Optional; defaults to the site default."),
      },
      ["collection"],
    ),
    run: async (args, client) => {
      const col = await resolveCollection(client, String(args.collection));
      const locale = await resolveLocale(client, args.locale);
      const paths = await client.list(entryFolder(col, locale));
      return { collection: col.name, locale: col.localized ? locale : null, count: paths.length, paths };
    },
  },
  {
    name: "read_content",
    description:
      "Read a single entry by path (from list_content). Returns its frontmatter fields and HTML body.",
    inputSchema: obj({ path: str("Repo path, e.g. 'content/pages/en/about.md'.") }, ["path"]),
    run: async (args, client) => {
      const entry = await client.read(await assertEntryPath(client, String(args.path)));
      return { path: entry.path, frontmatter: entry.data, body_html: entry.body };
    },
  },
  {
    name: "create_content",
    description:
      "Create a NEW entry on the staging branch. The filename is derived from the title. Bodies are HTML. The entry is published-visible (draft:false) unless you set draft:true in frontmatter. Nothing is public until you call publish.",
    inputSchema: obj(
      {
        collection: str("Collection to create in, e.g. 'pages' or 'posts'."),
        title: str("Human title. Also used to derive the filename slug."),
        locale: str("Locale for localized collections, e.g. 'en'. Optional; defaults to the site default."),
        frontmatter: {
          type: "object",
          description:
            "Additional frontmatter fields per the collection's schema (e.g. description, seo, template). 'title' and 'draft:false' are set for you unless overridden.",
          additionalProperties: true,
        },
        body_html: str("The entry body as HTML. Optional for body-less collections."),
      },
      ["collection", "title"],
    ),
    run: async (args, client, site) => {
      const col = await resolveCollection(client, String(args.collection));
      const title = String(args.title);
      const locale = await resolveLocale(client, args.locale);
      const path = `${entryFolder(col, locale)}/${slugify(title)}.md`;
      const extra = (args.frontmatter as Record<string, unknown>) ?? {};
      const data: Record<string, unknown> = { draft: false, ...extra, title };
      const body = col.body && col.body !== "none" ? String(args.body_html ?? "") : "";
      await client.ensureWorkingBranch();
      // "Create" must not silently overwrite: two titles that slugify alike, or a
      // retried call, would otherwise destroy an existing entry with no warning.
      if (await client.exists(path)) {
        throw new GitHubError(
          409,
          `"${path}" already exists. Use update_content to change it, or pick a different title.`,
        );
      }
      // exists() just proved there's no sha; passing null skips save()'s own lookup
      // of the same endpoint.
      const commit = await client.save(path, data, body, `Create ${path} via MCP`, null);
      return { created: path, commit, ...stagedNote(site) };
    },
  },
  {
    name: "update_content",
    description:
      'Update an existing entry on staging. Frontmatter keys you pass are merged into the existing frontmatter (others are preserved); body_html, if given, replaces the body. Not live until publish. To make a draft public, pass frontmatter {"draft": false}.',
    inputSchema: obj(
      {
        path: str("Repo path of the entry to update (from list_content)."),
        frontmatter: {
          type: "object",
          description: "Frontmatter fields to set/override. Merged into the existing frontmatter.",
          additionalProperties: true,
        },
        body_html: str("New HTML body. Omit to leave the body unchanged."),
      },
      ["path"],
    ),
    run: async (args, client, site) => {
      const path = await assertEntryPath(client, String(args.path));
      const current = await client.read(path);
      const merged = { ...current.data, ...((args.frontmatter as Record<string, unknown>) ?? {}) };
      const body = args.body_html !== undefined ? String(args.body_html) : current.body;
      const commit = await client.save(path, merged, body, `Update ${path} via MCP`);
      return { updated: path, commit, ...stagedNote(site) };
    },
  },
  {
    name: "delete_content",
    description: "Delete an entry on staging. Not live until publish.",
    inputSchema: obj(
      { path: str("Repo path of the entry to delete."), message: str("Optional commit message.") },
      ["path"],
    ),
    run: async (args, client, site) => {
      const path = await assertEntryPath(client, String(args.path));
      await client.remove(path, args.message ? String(args.message) : `Delete ${path} via MCP`);
      return { deleted: path, ...stagedNote(site) };
    },
  },
  {
    name: "list_changes",
    description:
      "List entries changed on staging but not yet published — the pending diff between staging and the live site.",
    inputSchema: obj({}),
    run: async (_args, client) => {
      const files = await client.pendingChanges();
      return { pending: files.length, files };
    },
  },
  {
    name: "publish",
    description:
      "Publish: merge staging into main to make all staged changes live. Returns whether a merge happened (false = nothing to publish). A merge conflict is reported so it can be resolved on GitHub.",
    inputSchema: obj({ message: str("Optional publish commit message.") }, []),
    run: async (args, client) => {
      const merged = await client.publish(args.message ? String(args.message) : "Publish via MCP");
      return merged
        ? { published: true, note: "Staged changes merged into main; the live site rebuilds shortly." }
        : { published: false, note: "Nothing to publish — staging matches the live site." };
    },
  },
];

export const TOOL_LIST = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

// ---------------------------------------------------------------------------
// JSON-RPC / MCP dispatch
// ---------------------------------------------------------------------------

export interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export function rpcError(id: RpcMessage["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function callTool(
  params: Record<string, unknown> | undefined,
  client: ContentClient,
  site: SiteContext,
): Promise<Record<string, unknown>> {
  const name = params?.name as string | undefined;
  const args = (params?.arguments as Record<string, unknown>) ?? {};
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = await tool.run(args, client, site);
    // Compact, NOT indent:2. Every byte here is a token the calling model pays for,
    // and indentation was ~46% of a get_schema response (14.9k chars → 8.0k). Models
    // parse minified JSON fine; this is the single largest saving on the wire.
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}

// Handle one JSON-RPC message. Returns a response object, or null for notifications
// (no id) which get no reply.
export async function handleMessage(
  msg: RpcMessage,
  client: ContentClient,
  site: SiteContext = NO_SITE,
): Promise<Record<string, unknown> | null> {
  // `null` is valid JSON, so it reaches here and would throw on destructuring —
  // a 500 (and, in a batch, one bad element discarding every good response)
  // where the spec wants -32600.
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    return rpcError(null, -32600, "Invalid Request: message must be a JSON-RPC object");
  }
  const { id, method, params } = msg;
  if (!method) return rpcError(id ?? null, -32600, "Invalid Request: missing method");
  // Notifications (no id) — acknowledge without a response.
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: (params?.protocolVersion as string) || SUPPORTED_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Edit this Lanza site's content. Reads/writes target a staging branch; call publish to make changes live.",
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOL_LIST } };
    case "tools/call":
      return { jsonrpc: "2.0", id, result: await callTool(params, client, site) };
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
