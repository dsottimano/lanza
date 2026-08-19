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
import {
  checkSite,
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
      // Two independent reasons to refuse, reported together so one call fixes both.
      const errors = problems.filter((p) => p.level === "error");
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

      const warnings = problems.filter((p) => p.level === "warning" && !UNTRUSTED_AUTHOR_CODES.has(p.code));
      return {
        written: [`${dir}/template.html`, `${dir}/fields.json`],
        position,
        ...(warnings.length ? { warnings: warnings.map((p) => `[${p.code}] ${p.message}`) } : {}),
        next:
          position === "page"
            ? "Set a page's `preset` to this template name to use it."
            : "Give a collection a `route` block naming this template so its entries get URLs.",
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

      const route = args.route as
        | { base?: unknown; template?: unknown; list?: { template?: unknown; sortBy?: unknown; order?: unknown } }
        | undefined;
      if (route) {
        const base = String(route.base ?? "");
        // Refuse exactly what gen-routes.mjs would die on. A route the CMS stores and
        // the build then rejects is a broken site nobody sees until the deploy fails.
        if (!ROUTE_SEGMENT.test(base)) {
          throw new GitHubError(400, `Refusing route.base "${base}": must be lowercase kebab-case, one segment.`);
        }
        if (RESERVED_ROUTE_BASES.has(base)) {
          throw new GitHubError(400, `route.base "${base}" is reserved by a built-in route and would shadow it.`);
        }
        const locales = (await readSiteFile(client)).locales;
        if (locales.includes(base)) {
          throw new GitHubError(400, `route.base "${base}" collides with the locale prefix of the same name.`);
        }
        const tpl = String(route.template ?? "");
        if (!ROUTE_SEGMENT.test(tpl)) {
          throw new GitHubError(400, `Refusing route.template "${tpl}": must be lowercase kebab-case.`);
        }
        const r: Record<string, unknown> = { base, template: tpl };
        if (route.list) {
          const listTpl = String(route.list.template ?? "");
          if (!ROUTE_SEGMENT.test(listTpl)) {
            throw new GitHubError(400, `Refusing route.list.template "${listTpl}": must be lowercase kebab-case.`);
          }
          const sortBy = route.list.sortBy === undefined ? "title" : String(route.list.sortBy);
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sortBy)) {
            throw new GitHubError(400, `route.list.sortBy "${sortBy}" is not a field name.`);
          }
          r.list = { template: listTpl, sortBy, order: route.list.order === "desc" ? "desc" : "asc" };
        }
        collection.route = r;
      }

      // Check the model AS IT WOULD BE. The pending schema is fed to the same whole-site
      // check `npm run check:site` runs, scoped to the templates this type references so
      // the read cost stays bounded — a route into a template that does not exist, or a
      // listing printing a field the type does not declare, both surface here.
      const pending = [...existing, collection];
      const touched = [
        fieldsFrom,
        ...(collection.route ? [String((collection.route as Record<string, unknown>).template)] : []),
        ...(collection.route && (collection.route as Record<string, unknown>).list
          ? [String(((collection.route as Record<string, unknown>).list as Record<string, unknown>).template)]
          : []),
      ];
      const { problems } = await checkSite(
        {
          readText: (path: string) =>
            path === "data/schema.json" ? JSON.stringify(pending) : client.readRaw(path),
          listTemplates: async () =>
            (await client.listAll("templates")).filter((i) => i.type === "dir").map((i) => i.name),
        },
        { only: [...new Set(touched)] },
      );
      const errors = problems.filter((p) => p.level === "error");
      if (errors.length) {
        throw new GitHubError(
          422,
          "Refused — data/schema.json was NOT changed. The model this would produce does not check out:\n" +
            errors.map((p) => `  • [${p.code}] ${p.where}: ${p.message}`).join("\n"),
        );
      }

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
