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
// The site-system checker, shared verbatim with `npm run check:site`. Plain .mjs and
// dependency-free so it survives the Pages bundler — see its header.
// The render side owns what a brand value and a link may be, and these are the exact
// predicates it applies. Imported, not re-stated: a writer that disagreed with the
// renderer would accept settings that silently do nothing on the page.
import { validateBrand, FONT_CATALOG, type BrandConfig } from "../../frontend/lib/appearance";
import { isSafeUrl } from "../../frontend/lib/url";
import {
  checkSite,
  checkPart,
  checkTemplate,
  siteSystemContract,
  POSITIONS,
  UNTRUSTED_AUTHOR_CODES,
  ROUTE_SEGMENT,
  RESERVED_ROUTE_BASES,
  COLLECTION_NAME,
} from "./site-system.mjs";

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

// A template folder name. Identical to the pattern gen-routes.mjs enforces on
// `route.template`, and for the same reason: it becomes a directory name and is
// interpolated into generated code. Kept strict rather than merely safe — a name that
// passes here but not there would produce a template no route can ever reference.
const TEMPLATE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Every folder collection with its declared field names — what a LIST template's
// `listing.item` is checked against. Read straight from schema.json rather than via
// getCollections(), which drops the fields (it exists for path confinement).
async function collectionFields(client: ContentClient): Promise<Map<string, Set<string>>> {
  const raw = await client.readRaw("data/schema.json");
  const schema = raw ? (JSON.parse(raw) as unknown) : [];
  if (!Array.isArray(schema)) return new Map();
  return new Map(
    (schema as Array<{ name?: string; kind?: string; fields?: Array<{ name?: string }> }>)
      .filter((c) => c.kind === "folder" && typeof c.name === "string")
      .map((c) => [
        c.name as string,
        new Set((c.fields ?? []).map((f) => f.name).filter((n): n is string => typeof n === "string")),
      ]),
  );
}


// ── Settings (the `kind: "files"` collections) ───────────────────────────────
// Brand, menu and SEO defaults are what turn "a site that works" into "the site they
// asked for", and until now MCP could not touch any of them — getCollections() drops
// every folderless collection, so Settings was a blind spot.
//
// Paths are DERIVED from a fixed map, never read out of data/schema.json. §3 of
// docs/security-model.md: schema.json is not a security boundary and must not become
// one, and a `files` entry pointing at `.github/workflows/x.json` would otherwise turn
// "change the menu" into "write CI config".
const SETTINGS_FILES = {
  brand: { base: "data/appearance", localized: false },
  menu: { base: "data/menu", localized: true },
  seo: { base: "data/seo", localized: true },
} as const;

type SettingName = keyof typeof SETTINGS_FILES;

async function settingPath(client: ContentClient, name: SettingName, rawLocale: unknown): Promise<string> {
  const spec = SETTINGS_FILES[name];
  if (!spec.localized) return `${spec.base}.json`;
  // resolveLocale confines this to a locale the site declares — the same guard the
  // entry tools use, and for the same reason: it is interpolated into a write path.
  return `${spec.base}.${await resolveLocale(client, rawLocale)}.json`;
}

async function readSetting(client: ContentClient, path: string): Promise<Record<string, unknown>> {
  const raw = await client.readRaw(path);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

const writeSetting = (client: ContentClient, path: string, value: unknown, what: string) =>
  client.saveText(path, `${JSON.stringify(value, null, 2)}\n`, `Set ${what} via MCP`);

/**
 * Menu items, checked against the ONE safe-URL policy (frontend/lib/url.ts).
 *
 * HTML-escaping does not help here: the parser decodes entities before the URL is
 * parsed, so `javascript&#58;alert(1)` in an href still runs — on the origin that
 * serves /admin. The renderer already neutralizes an unsafe URL to `#`, so this is not
 * the only guard; it exists so the agent is TOLD, instead of shipping a menu whose
 * links silently go nowhere. Mirrors what the CMS refuses to save (admin/src/backend/menu.ts).
 */
function menuItems(raw: unknown, where: string): Array<{ label: string; url: string }> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new GitHubError(400, `${where} must be an array of { label, url }.`);
  return raw.map((item, i) => {
    const it = (item ?? {}) as { label?: unknown; url?: unknown };
    const label = String(it.label ?? "").trim();
    const url = String(it.url ?? "").trim();
    if (!label) throw new GitHubError(400, `${where}[${i}] has no label.`);
    if (!isSafeUrl(url)) {
      throw new GitHubError(
        400,
        `${where}[${i}] url ${JSON.stringify(url)} is not a link this site will render. ` +
          "Use a root-relative path (/properties/), an absolute http(s) URL, mailto:, tel:, or #anchor.",
      );
    }
    return { label, url };
  });
}


/**
 * Validate a `route` block exactly as scripts/gen-routes.mjs would, and normalize it.
 *
 * The generator is the last gate before these values land in a directory name and in
 * generated .astro code, and it DIES rather than skipping — so a route the CMS stores
 * happily and the build then rejects is a broken site nobody sees until the deploy
 * fails. The name rules are imported from the checker, which gen-routes.mjs also imports.
 */
async function normalizeRoute(client: ContentClient, raw: unknown): Promise<Record<string, unknown>> {
  const route = (raw ?? {}) as {
    base?: unknown;
    template?: unknown;
    list?: { template?: unknown; sortBy?: unknown; order?: unknown } | null;
  };
  const base = String(route.base ?? "");
  if (!ROUTE_SEGMENT.test(base)) {
    throw new GitHubError(400, `Refusing route.base "${base}": must be lowercase kebab-case, one segment.`);
  }
  if (RESERVED_ROUTE_BASES.has(base)) {
    throw new GitHubError(400, `route.base "${base}" is reserved by a built-in route and would shadow it.`);
  }
  if ((await readSiteFile(client)).locales.includes(base)) {
    throw new GitHubError(400, `route.base "${base}" collides with the locale prefix of the same name.`);
  }
  const tpl = String(route.template ?? "");
  if (!ROUTE_SEGMENT.test(tpl)) {
    throw new GitHubError(400, `Refusing route.template "${tpl}": must be lowercase kebab-case.`);
  }
  const out: Record<string, unknown> = { base, template: tpl };
  if (route.list) {
    const listTpl = String(route.list.template ?? "");
    if (!ROUTE_SEGMENT.test(listTpl)) {
      throw new GitHubError(400, `Refusing route.list.template "${listTpl}": must be lowercase kebab-case.`);
    }
    const sortBy = route.list.sortBy === undefined ? "title" : String(route.list.sortBy);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sortBy)) {
      throw new GitHubError(400, `route.list.sortBy "${sortBy}" is not a field name.`);
    }
    out.list = { template: listTpl, sortBy, order: route.list.order === "desc" ? "desc" : "asc" };
  }
  return out;
}

/** The template folders a collection's route references, for scoping a check. */
function routeTemplates(collection: Record<string, unknown>): string[] {
  const route = collection.route as { template?: unknown; list?: { template?: unknown } } | undefined;
  if (!route) return [];
  return [String(route.template ?? ""), ...(route.list ? [String(route.list.template ?? "")] : [])].filter(Boolean);
}

/**
 * Run the whole-site check against the model AS IT WOULD BE, and throw if it does not
 * hold. Scoped to the templates the change touches so the read cost stays bounded.
 *
 * The pending schema is injected rather than committed first: schema.json is compiled
 * into code `astro build` imports, so a model that does not check out does not fail this
 * CALL, it fails the tenant's DEPLOY. Returns the warnings, which are worth reporting.
 */
async function checkPendingModel(
  client: ContentClient,
  pending: unknown[],
  touched: string[],
): Promise<Array<{ level: string; code: string; where: string; message: string }>> {
  const { problems } = await checkSite(
    {
      readText: (path: string) => (path === "data/schema.json" ? JSON.stringify(pending) : client.readRaw(path)),
      listTemplates: async () =>
        (await client.listAll("templates")).filter((i) => i.type === "dir").map((i) => i.name),
    },
    { only: [...new Set(touched.filter(Boolean))] },
  );
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) {
    throw new GitHubError(
      422,
      "Refused — data/schema.json was NOT changed. The model this would produce does not check out:\n" +
        errors.map((p) => `  • [${p.code}] ${p.where}: ${p.message}`).join("\n"),
    );
  }
  return problems;
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
    name: "describe_site_system",
    description:
      "Explain how a Lanza site is COMPOSED — the layer model, what each template position " +
      "puts in scope, the field widgets the CMS can render, the reserved names, and every " +
      "way a site can be silently wrong. Call this before writing a template, declaring " +
      "fields, or giving a content type a URL. Lanza's composition failures do not raise " +
      "errors: a misspelled placeholder renders as empty text and the build passes. Takes " +
      "no arguments and reads nothing — it is the same data the checker enforces.",
    inputSchema: obj({}),
    run: async () => siteSystemContract(),
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
    name: "write_template",
    description:
      "Create or replace a template — templates/<name>/template.html and fields.json — on " +
      "the staging branch. A template is the markup for a page or a content type's " +
      "entries; fields.json declares every editable spot in it. NOTHING IS WRITTEN unless " +
      "the template passes the checker, and that refusal is the point: a misspelled " +
      "{{placeholder}} renders as empty text with no error, so being refused is the only " +
      "way to find out. Call describe_site_system first — it gives the widgets, the " +
      "reserved names, what each position puts in scope, and the markup an agent-written " +
      "template may not contain (no script, no event handlers, no iframes: the engine " +
      "renders at build time, so listings, galleries and detail pages are structure and " +
      "CSS). Replacing an existing template is allowed and is a reviewable, revertable " +
      "change like any other. Not live until publish.",
    inputSchema: obj(
      {
        name: str("Template folder name, lowercase kebab-case, e.g. 'property' or 'property-index'."),
        template_html: str("The markup, with {{placeholders}} for every editable spot."),
        fields: {
          type: "object",
          description:
            'The fields.json body: {"name": "<same as name>", "fields": [{name,label,widget}, …]}. ' +
            'Set "body": true to give the entry a rich-text canvas, and render it as {{{ body }}}. ' +
            'A listing template also needs "listing": {"of": "<collection>", "item": [<field names>]}.',
          additionalProperties: true,
        },
        position: str(
          "Where this template is used: 'page' (a page's own slots), 'detail' (one entry of a " +
            "collection — scope is its frontmatter), or 'list' (a collection's index). Decides " +
            "what is in scope, so the same markup is correct in one and silently empty in another. " +
            "Defaults to 'page'.",
        ),
      },
      ["name", "template_html", "fields"],
    ),
    run: async (args, client, site) => {
      const name = String(args.name);
      if (!TEMPLATE_NAME.test(name)) {
        throw new GitHubError(
          400,
          `Refusing template name "${name}": must be lowercase kebab-case, one segment ` +
            "(it becomes a directory name and is compiled into a generated route).",
        );
      }
      const position = args.position === undefined ? "page" : String(args.position);
      if (!POSITIONS.has(position)) {
        throw new GitHubError(400, `Unknown position "${position}". Use page, detail or list.`);
      }
      const html = String(args.template_html);
      const given = (args.fields as Record<string, unknown>) ?? {};
      // fields.json's `name` must match the folder — a page's `preset` names the FOLDER,
      // and a mismatch renders "Unknown template" on a live URL. Filled in rather than
      // refused when absent: it is not a decision the agent gets to make differently.
      if (given.name !== undefined && given.name !== name) {
        throw new GitHubError(
          400,
          `fields.json says name ${JSON.stringify(given.name)} but the template folder is "${name}". They must match.`,
        );
      }
      // A copy, not a mutation of the caller's object — and `name` first, so the
      // committed fields.json reads like a hand-written one.
      const fields = { name, ...given };

      const problems = checkTemplate({ name, html, fields, position }, {
        collections: await collectionFields(client),
      });
      // A listing naming a collection that does not exist YET is not a refusal here.
      // The natural build order is detail template → listing template → content type
      // (the type's fields come from the detail template, and its route names the
      // listing), so a strict check on both sides deadlocks: the listing cannot be
      // written before the type, and the type's route cannot name a listing that does
      // not exist. Safe to defer — a template nothing routes to renders at no URL, and
      // create_content_type re-checks the whole model before it grants one.
      const deferred = problems.filter((p) => p.code === "listing-unknown-collection");
      // Two independent reasons to refuse, reported together so one call fixes both.
      const errors = problems.filter((p) => p.level === "error" && p.code !== "listing-unknown-collection");
      const unsafe = problems.filter((p) => UNTRUSTED_AUTHOR_CODES.has(p.code));
      if (errors.length || unsafe.length) {
        throw new GitHubError(
          422,
          `Refused — nothing was written. Fix these and call again:\n` +
            [...errors, ...unsafe].map((p) => `  • [${p.code}] ${p.message}`).join("\n") +
            (unsafe.length
              ? "\nMarkup a browser would act on is refused from an agent because this site's " +
                "origin also serves /admin: script in a template is CMS takeover, not bad content. " +
                "A build-time template needs none of it."
              : ""),
        );
      }

      await client.ensureWorkingBranch();
      const dir = `templates/${name}`;
      await client.saveText(`${dir}/template.html`, html, `Write template ${name} via MCP`);
      await client.saveText(
        `${dir}/fields.json`,
        `${JSON.stringify(fields, null, 2)}\n`,
        `Write fields for template ${name} via MCP`,
      );

      const warnings = [
        ...problems.filter((p) => p.level === "warning" && !UNTRUSTED_AUTHOR_CODES.has(p.code)),
        ...deferred,
      ];
      return {
        written: [`${dir}/template.html`, `${dir}/fields.json`],
        position,
        ...(warnings.length ? { warnings: warnings.map((p) => `[${p.code}] ${p.message}`) } : {}),
        next: deferred.length
          ? "That collection does not exist yet — call create_content_type to create it, " +
            "then validate_site to confirm the listing resolves."
          : position === "page"
            ? "Set a page's `preset` to this template name to use it."
            : "Give a collection a `route` block naming this template so its entries get URLs.",
        ...stagedNote(site),
      };
    },
  },
  {
    name: "update_content_type",
    description:
      "Change a content type that already exists — rename what it is CALLED, give it a URL " +
      "it did not have, point it at a different template, or re-read its fields after you " +
      "edited that template. This is the tool for 'no, call them Listings' and for adding a " +
      "listing page once you have written one. It does NOT rename the type's identifier or " +
      "move its entries: `name` is what its content folder is called and what URLs are " +
      "already built from, so changing it is a migration, not an edit. Nothing is written " +
      "unless the whole model still checks out. Not live until publish.",
    inputSchema: obj(
      {
        name: str("The existing collection to change, e.g. 'properties'."),
        label: str("New plural label shown in the CMS, e.g. 'Listings'."),
        labelSingular: str("New singular label, e.g. 'Listing'."),
        fieldsFrom: str(
          "Re-read the fields from this template's fields.json. Call this after write_template " +
            "adds or removes a field — the type's fields are a COPY, and go stale otherwise.",
        ),
        route: {
          type: "object",
          description:
            "Replace the route: { base, template, list: { template, sortBy, order } }. " +
            "Pass it to give an unrouted type its URLs, or to add a listing page.",
          additionalProperties: true,
        },
        body: str("'rich' to give entries an HTML body canvas, 'none' for frontmatter only."),
        thumbnail: str("Field name to show as the entry thumbnail in the CMS."),
      },
      ["name"],
    ),
    run: async (args, client, site) => {
      const name = String(args.name);
      const raw = await client.readRaw("data/schema.json");
      if (!raw) throw new GitHubError(404, "This site has no data/schema.json — it may not be a Lanza site.");
      const schema = JSON.parse(raw) as unknown;
      if (!Array.isArray(schema)) {
        throw new GitHubError(500, "data/schema.json is not a collection array — this site's content model is malformed.");
      }
      const existing = schema as Array<Record<string, unknown>>;
      const index = existing.findIndex((c) => c.name === name);
      if (index < 0) {
        throw new GitHubError(404, `No collection named "${name}". Call list_collections to see what exists.`);
      }
      const current = existing[index];
      if (current.kind !== "folder") {
        throw new GitHubError(400, `"${name}" is not a content type — it is a settings collection. Use set_brand / set_menu / set_seo.`);
      }

      const updated: Record<string, unknown> = { ...current };
      if (args.label !== undefined) updated.label = String(args.label);
      if (args.labelSingular !== undefined) updated.labelSingular = String(args.labelSingular);
      if (args.body !== undefined) updated.body = args.body === "rich" ? "rich" : "none";
      if (args.thumbnail !== undefined) updated.thumbnail = String(args.thumbnail);

      // Re-deriving from the template is the whole point: the collection's fields are a
      // COPY of the template's fields.json, so editing the template leaves them stale and
      // the CMS stops offering an input the page prints. See "Declare once".
      let fieldsFrom: string | undefined;
      if (args.fieldsFrom !== undefined) {
        fieldsFrom = String(args.fieldsFrom);
        if (!ROUTE_SEGMENT.test(fieldsFrom)) {
          throw new GitHubError(400, `Refusing fieldsFrom "${fieldsFrom}": must be a lowercase kebab-case template folder name.`);
        }
        const declRaw = await client.readRaw(`templates/${fieldsFrom}/fields.json`);
        if (!declRaw) throw new GitHubError(404, `No templates/${fieldsFrom}/fields.json.`);
        const decl = JSON.parse(declRaw) as { fields?: unknown };
        if (!Array.isArray(decl.fields)) {
          throw new GitHubError(422, `templates/${fieldsFrom}/fields.json declares no "fields" array.`);
        }
        updated.fields = decl.fields;
      }

      if (args.route !== undefined) updated.route = await normalizeRoute(client, args.route);

      const pending = existing.map((c, i) => (i === index ? updated : c));
      const problems = await checkPendingModel(client, pending, [
        ...(fieldsFrom ? [fieldsFrom] : []),
        ...routeTemplates(updated),
      ]);

      await client.ensureWorkingBranch();
      await client.saveText("data/schema.json", `${JSON.stringify(pending, null, 2)}\n`, `Update content type ${name} via MCP`);

      const route = updated.route as { base?: string } | undefined;
      return {
        updated: name,
        label: updated.label,
        fields: (updated.fields as Array<{ name?: string }>).map((f) => f.name),
        ...(route ? { url: `/${route.base}/` } : {}),
        warnings: problems.filter((p) => p.level === "warning").map((p) => `[${p.code}] ${p.message}`),
        ...stagedNote(site),
      };
    },
  },
  {
    name: "write_part",
    description:
      "Write the site's header or footer — the chrome that wraps every page. A part is " +
      "NOT a template: it has no fields.json, because its data is not free-form page slots " +
      "but computed site data. What is in scope is fixed and is listed as " +
      "`reserved.partData` by describe_site_system — the site name, the home URL, the menus " +
      "you set with set_menu, the language switcher, the year. Anything else renders as " +
      "empty text, so a name that is not on that list is refused. Same markup rules as " +
      "write_template: structure and CSS, no script. Not live until publish.",
    inputSchema: obj(
      {
        name: str("'header' or 'footer'."),
        template_html: str(
          "The markup. Loop the menu with {{#each menuHeader}}<a href=\"{{ url }}\">{{ label }}</a>{{/each}} " +
            "(or menuFooter), and see describe_site_system for every name in scope.",
        ),
      },
      ["name", "template_html"],
    ),
    run: async (args, client, site) => {
      const name = String(args.name);
      if (name !== "header" && name !== "footer") {
        throw new GitHubError(400, `Refusing part "${name}": a site has exactly two, "header" and "footer".`);
      }
      const html = String(args.template_html);
      // checkPart resolves against PART_DATA — the contract Base.astro actually supplies —
      // and runs the same safety classification write_template does.
      const problems = checkPart(name, html);
      const errors = problems.filter((p) => p.level === "error");
      const unsafe = problems.filter((p) => UNTRUSTED_AUTHOR_CODES.has(p.code));
      if (errors.length || unsafe.length) {
        throw new GitHubError(
          422,
          "Refused — nothing was written. Fix these and call again:\n" +
            [...errors, ...unsafe].map((p) => `  • [${p.code}] ${p.message}`).join("\n") +
            "\nCall describe_site_system and read `reserved.partData` for every name a part may use.",
        );
      }

      await client.ensureWorkingBranch();
      const path = `templates/parts/${name}.html`;
      await client.saveText(path, html, `Write ${name} part via MCP`);
      const warnings = problems.filter((p) => p.level === "warning" && !UNTRUSTED_AUTHOR_CODES.has(p.code));
      return {
        written: path,
        ...(warnings.length ? { warnings: warnings.map((p) => `[${p.code}] ${p.message}`) } : {}),
        ...stagedNote(site),
      };
    },
  },
  {
    name: "create_content_type",
    description:
      "Add a content type (a folder collection) to the site's model, optionally with the " +
      "URL its entries render at. This is what turns 'properties' or 'recipes' from an " +
      "idea into something the CMS stores and the site publishes. Its FIELDS ARE NOT " +
      "PASSED HERE: they are read from the detail template's fields.json, which is the " +
      "one place they are declared — write_template first, then name it as fieldsFrom. " +
      "Without a `route` the entries are stored and editable but render at no URL, which " +
      "is almost never what is wanted. Nothing is written unless the whole model still " +
      "checks out. Not live until publish.",
    inputSchema: obj(
      {
        name: str("Collection name, a plain identifier, plural — e.g. 'properties'. Also names its content folder."),
        label: str("Plural label shown in the CMS, e.g. 'Properties'."),
        labelSingular: str("Singular label, e.g. 'Property'. Optional."),
        fieldsFrom: str("Template folder whose fields.json declares this type's fields, e.g. 'property'."),
        localized: { type: "boolean", description: "One subfolder of entries per locale. Defaults to false." },
        body: str("'rich' to give entries an HTML body canvas, 'none' for frontmatter only. Defaults to 'none'."),
        thumbnail: str("Field name to show as the entry thumbnail in the CMS, e.g. 'featuredImage'. Optional."),
        route: {
          type: "object",
          description:
            "Where entries render. { base: 'properties', template: 'property', " +
            "list: { template: 'property-index', sortBy: 'price', order: 'asc' } }. " +
            "Omit `list` for a detail page with no index.",
          additionalProperties: true,
        },
      },
      ["name", "label", "fieldsFrom"],
    ),
    run: async (args, client, site) => {
      const name = String(args.name);
      if (!COLLECTION_NAME.test(name)) {
        throw new GitHubError(
          400,
          `Refusing collection name "${name}": must be a plain identifier (letters, digits, _ and $; ` +
            "not starting with a digit). It is emitted as a binding in generated code.",
        );
      }

      const raw = await client.readRaw("data/schema.json");
      if (!raw) throw new GitHubError(404, "This site has no data/schema.json — it may not be a Lanza site.");
      const schema = JSON.parse(raw) as unknown;
      if (!Array.isArray(schema)) {
        throw new GitHubError(500, "data/schema.json is not a collection array — this site's content model is malformed.");
      }
      const existing = schema as Array<Record<string, unknown>>;
      if (existing.some((c) => c.name === name)) {
        throw new GitHubError(
          409,
          `A collection named "${name}" already exists. Adding a type never overwrites one — ` +
            "edit it in the CMS content-type editor, or pick another name.",
        );
      }

      // The template's fields.json is the ONE declaration of this type's shape. Typing
      // the fields again here is how the two drift, so they are not accepted as input.
      const fieldsFrom = String(args.fieldsFrom);
      if (!ROUTE_SEGMENT.test(fieldsFrom)) {
        throw new GitHubError(400, `Refusing fieldsFrom "${fieldsFrom}": must be a lowercase kebab-case template folder name.`);
      }
      const declRaw = await client.readRaw(`templates/${fieldsFrom}/fields.json`);
      if (!declRaw) {
        throw new GitHubError(
          404,
          `No templates/${fieldsFrom}/fields.json. Call write_template to create the detail ` +
            "template first — its fields are what this content type stores.",
        );
      }
      const decl = JSON.parse(declRaw) as { fields?: unknown };
      if (!Array.isArray(decl.fields)) {
        throw new GitHubError(422, `templates/${fieldsFrom}/fields.json declares no "fields" array.`);
      }

      // The folder is DERIVED, never accepted. §3 of docs/security-model.md: schema.json
      // is not a security boundary, and a collection's folder is what create_content
      // builds a write path from. Deriving it puts every entry under content/ by
      // construction instead of by validation.
      const collection: Record<string, unknown> = {
        kind: "folder",
        name,
        label: String(args.label),
        ...(args.labelSingular ? { labelSingular: String(args.labelSingular) } : {}),
        folder: `content/${name}`,
        body: args.body === "rich" ? "rich" : "none",
        ...(args.thumbnail ? { thumbnail: String(args.thumbnail) } : {}),
        ...(args.localized ? { localized: true } : {}),
        fields: decl.fields,
      };

      if (args.route) collection.route = await normalizeRoute(client, args.route);

      const pending = [...existing, collection];
      const problems = await checkPendingModel(client, pending, [fieldsFrom, ...routeTemplates(collection)]);

      await client.ensureWorkingBranch();
      await client.saveText(
        "data/schema.json",
        `${JSON.stringify(pending, null, 2)}\n`,
        `Add content type ${name} via MCP`,
      );

      return {
        created: name,
        folder: collection.folder,
        fieldsFrom,
        fields: (decl.fields as Array<{ name?: string }>).map((f) => f.name),
        ...(collection.route ? { url: `/${(collection.route as { base: string }).base}/` } : {}),
        // `next`, not `note` — stagedNote() owns `note`, and spreading it after this
        // would silently swallow the one line that matters when there is no route.
        next: collection.route
          ? `Entries render at /${(collection.route as { base: string }).base}/<slug>/. Create one with create_content.`
          : "This type has NO URL: entries will be stored and editable but render nowhere. " +
            "Write a detail template and add a `route` block to give them one.",
        warnings: problems.filter((p) => p.level === "warning").map((p) => `[${p.code}] ${p.message}`),
        ...stagedNote(site),
      };
    },
  },
  {
    name: "get_settings",
    description:
      "Read everything that decides how this site LOOKS and reads: the brand (colours, " +
      "corner radius, fonts, light/dark), the header and footer menus, and the SEO " +
      "defaults including the site name and tagline. Call before changing any of them — " +
      "the setters replace what you pass and keep the rest, so you need to know what is " +
      "there. Also returns the font ids and brand colour slots that are actually valid.",
    inputSchema: obj({ locale: str("Locale for the menu and SEO defaults. Optional; defaults to the site default.") }, []),
    run: async (args, client) => {
      const locale = await resolveLocale(client, args.locale);
      const [appearance, menu, seo] = await Promise.all([
        readSetting(client, await settingPath(client, "brand", locale)),
        readSetting(client, await settingPath(client, "menu", locale)),
        readSetting(client, await settingPath(client, "seo", locale)),
      ]);
      const locations = (menu.locations ?? {}) as Record<string, { desktop?: unknown }>;
      return {
        locale,
        brand: appearance.brand ?? {},
        logo: appearance.logo ?? "",
        menu: {
          header: locations.header?.desktop ?? [],
          footer: locations.footer?.desktop ?? [],
        },
        seo,
        // The valid values, so a setter is never a guess-and-get-refused round trip.
        available: {
          fonts: Object.keys(FONT_CATALOG),
          colors: ["bg", "surface", "ink", "muted", "accent", "border"],
          schemes: ["auto", "light", "dark"],
        },
      };
    },
  },
  {
    name: "set_brand",
    description:
      "Set how the site looks: colours, corner radius, fonts, motion, and whether it is " +
      "pinned light or dark. Merges into the existing brand — pass only what you are " +
      "changing. Colours are hex; fonts are ids from get_settings.available.fonts (an " +
      "unknown one is REFUSED, not ignored, because a font that silently does nothing " +
      "looks like the tool worked). This is the layer under everything else: it applies " +
      "to every page, including ones you have not written yet. Not live until publish.",
    inputSchema: obj(
      {
        colors: {
          type: "object",
          description:
            "Hex colours by role: bg (page), surface (cards), ink (text), muted (secondary " +
            "text), accent (links/buttons), border. e.g. {\"accent\": \"#1c6b53\"}.",
          additionalProperties: true,
        },
        radius: str('Corner radius as a plain length: "0px" for sharp, "10px", "18px" for soft.'),
        fonts: {
          type: "object",
          description: 'Font ids: {"heading": "fraunces", "body": "inter"}. See get_settings.',
          additionalProperties: true,
        },
        scheme: str('"auto" follows the visitor\'s OS setting (default), or pin "light" / "dark".'),
        motion: str('"on" enables hover/press feedback, "off" disables it.'),
        logo: str("Path or URL of the logo image. Optional."),
      },
      [],
    ),
    run: async (args, client, site) => {
      const path = await settingPath(client, "brand", undefined);
      const current = await readSetting(client, path);
      const brand: BrandConfig = {
        ...((current.brand as BrandConfig) ?? {}),
        ...(args.colors ? { colors: { ...((current.brand as BrandConfig)?.colors ?? {}), ...(args.colors as object) } } : {}),
        ...(args.radius !== undefined ? { radius: String(args.radius) } : {}),
        ...(args.fonts ? { fonts: { ...((current.brand as BrandConfig)?.fonts ?? {}), ...(args.fonts as object) } } : {}),
        ...(args.scheme !== undefined ? { scheme: args.scheme as BrandConfig["scheme"] } : {}),
        ...(args.motion !== undefined ? { motion: args.motion as BrandConfig["motion"] } : {}),
      };
      // Refuse rather than let resolveBrand quietly drop it — see validateBrand.
      const bad = validateBrand(brand);
      if (args.logo !== undefined && String(args.logo) && !isSafeUrl(String(args.logo))) {
        bad.push(`logo ${JSON.stringify(args.logo)} is not a usable image URL.`);
      }
      if (bad.length) {
        throw new GitHubError(400, `Refused — nothing was changed:\n${bad.map((b) => `  • ${b}`).join("\n")}`);
      }

      await client.ensureWorkingBranch();
      const next = { ...current, brand, ...(args.logo !== undefined ? { logo: String(args.logo) } : {}) };
      await writeSetting(client, path, next, "brand");
      return { brand, ...stagedNote(site) };
    },
  },
  {
    name: "set_menu",
    description:
      "Set the header and/or footer navigation for one locale. Pass the WHOLE list for a " +
      "location — it replaces that list, so include the items you want to keep (get_settings " +
      "shows them). A section you created with create_content_type has no nav link until you " +
      "add one here. URLs must be root-relative (/properties/), absolute http(s), mailto:, " +
      "tel: or #anchor; anything else is refused, because the site renders it as a dead link. " +
      "Not live until publish.",
    inputSchema: obj(
      {
        header: {
          type: "array",
          description: 'Header items in order: [{"label": "Properties", "url": "/properties/"}]. Omit to leave unchanged.',
          items: { type: "object", additionalProperties: true },
        },
        footer: {
          type: "array",
          description: "Footer items in order. Omit to leave unchanged.",
          items: { type: "object", additionalProperties: true },
        },
        locale: str("Locale to set the menu for. Optional; defaults to the site default."),
      },
      [],
    ),
    run: async (args, client, site) => {
      if (args.header === undefined && args.footer === undefined) {
        throw new GitHubError(400, "Nothing to set — pass `header`, `footer`, or both.");
      }
      const locale = await resolveLocale(client, args.locale);
      const path = await settingPath(client, "menu", locale);
      const current = await readSetting(client, path);
      const locations = { ...((current.locations as Record<string, unknown>) ?? {}) };

      for (const loc of ["header", "footer"] as const) {
        if (args[loc] === undefined) continue;
        const existing = (locations[loc] ?? {}) as Record<string, unknown>;
        // Only `desktop` is set. tablet/mobile are a responsive override the CMS owns
        // and null means "inherit desktop" — replacing them here would silently discard
        // a per-device menu the owner configured by hand.
        locations[loc] = { tablet: null, mobile: null, ...existing, desktop: menuItems(args[loc], loc) };
      }

      await client.ensureWorkingBranch();
      await writeSetting(client, path, { ...current, locations }, `${locale} menu`);
      return {
        locale,
        header: (locations.header as { desktop?: unknown } | undefined)?.desktop ?? [],
        footer: (locations.footer as { desktop?: unknown } | undefined)?.desktop ?? [],
        ...stagedNote(site),
      };
    },
  },
  {
    name: "set_seo",
    description:
      "Set the site's name, tagline and search/social defaults for one locale — what shows " +
      "in a browser tab, in Google, and when the site is shared. `siteName` is also the " +
      "name in the site's own header. Merges into what is there; pass only what you are " +
      "changing. Not live until publish.",
    inputSchema: obj(
      {
        siteName: str("The site's name, e.g. 'Bonaparte Properties'. Also used by the header."),
        titleTemplate: str("How a page title is framed, with %s for the page's own title, e.g. '%s · Bonaparte'."),
        defaultTitle: str("Title for the home page and anything without its own."),
        defaultDescription: str("One-sentence description used when a page has none."),
        defaultOgImage: str("Image shown when a page is shared. Path or absolute URL."),
        twitter: str("Site @handle. Optional."),
        locale: str("Locale to set these for. Optional; defaults to the site default."),
      },
      [],
    ),
    run: async (args, client, site) => {
      const locale = await resolveLocale(client, args.locale);
      const path = await settingPath(client, "seo", locale);
      const current = await readSetting(client, path);

      const next = { ...current };
      for (const k of ["siteName", "titleTemplate", "defaultTitle", "defaultDescription", "twitter"]) {
        if (args[k] !== undefined) next[k] = String(args[k]);
      }
      if (args.defaultOgImage !== undefined) {
        const img = String(args.defaultOgImage);
        if (img && !isSafeUrl(img)) {
          throw new GitHubError(400, `defaultOgImage ${JSON.stringify(img)} is not a usable image URL. Nothing was changed.`);
        }
        next.defaultOgImage = img;
      }
      if (Object.keys(next).length === Object.keys(current).length &&
          Object.entries(next).every(([k, v]) => current[k] === v)) {
        throw new GitHubError(400, "Nothing to set — pass at least one field to change.");
      }

      await client.ensureWorkingBranch();
      await writeSetting(client, path, next, `${locale} SEO defaults`);
      return { locale, seo: next, ...stagedNote(site) };
    },
  },
  {
    name: "validate_site",
    description:
      "Check this site's templates, fields and routes against each other and return every " +
      "problem found. Read-only. Run it after changing a template or the content model and " +
      "BEFORE publish — the failures it reports are the ones that produce no error of their " +
      "own: a placeholder that renders empty, a field the owner fills that appears nowhere, " +
      "a route pointing at a template that does not exist. Pass `template` to check one " +
      "folder instead of the whole site. Call describe_site_system for what each code means.",
    inputSchema: obj(
      { template: str("Check only this template folder, e.g. 'event'. Omit to check the whole site.") },
      [],
    ),
    run: async (args, client) => {
      const only = args.template === undefined ? undefined : [String(args.template)];
      const { problems, templates, skipped } = await checkSite(
        {
          readText: (path: string) => client.readRaw(path),
          listTemplates: async () =>
            (await client.listAll("templates"))
              .filter((i) => i.type === "dir")
              .map((i) => i.name),
        },
        // A Worker gets ~50 subrequests per request and each template costs two reads
        // (template.html + fields.json), each of which may miss on staging and retry
        // against main. Six keeps the worst case comfortably inside that; anything
        // left out is named in `skipped` rather than quietly treated as clean.
        { maxTemplates: 6, only },
      );
      const errors = problems.filter((p) => p.level === "error");
      return {
        ok: errors.length === 0,
        checked: templates,
        ...(skipped.length
          ? {
              skipped,
              skippedNote:
                "Not checked — this call reads at most 6 template folders. Re-run with " +
                "`template` set to each of these to cover them.",
            }
          : {}),
        errors: errors.length,
        warnings: problems.length - errors.length,
        problems,
      };
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
