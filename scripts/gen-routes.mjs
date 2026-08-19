// Generates public ROUTE FILES for collections that declare one, from
// data/schema.json. Runs before `astro build` (bin/lanza.mjs), next to
// gen-content-config.mjs.
//
// WHY: gen-content-config.mjs already makes a CMS-invented content type a real Astro
// collection — it stores, it validates, it edits. But every URL was a hand-written
// .astro file, so the new type rendered NOWHERE, and a tenant cannot ship .astro to
// fix that. "I want a simple event site" died right here.
//
// A folder collection opts in with a `route` block:
//
//   "route": {
//     "base": "events",                     // /events/<slug>/ (+ /<locale>/events/…)
//     "template": "event",                  // templates/event/ renders one entry
//     "list": { "template": "event-index",  // templates/event-index/ renders /events/
//               "sortBy": "startDate", "order": "asc" }
//   }
//
// SECURITY: schema.json is UNTRUSTED. Two writers reach it and neither is a control —
// an uploaded theme bundle, and any editor session doing `PUT contents/data/schema.json`.
// Its values land in FILE PATHS and in code that `astro build` imports. So this
// generator validates every value against a strict allowlist pattern and refuses the
// build otherwise — same posture as gen-content-config.mjs and gen-redirects.mjs.
import { readFileSync, writeFileSync, mkdirSync, rmSync, rmdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { ROUTE_SEGMENT, RESERVED_ROUTE_BASES } from "../functions/_lib/site-system.mjs";

// Input is TENANT data; output is CODE inside this package's srcDir (frontend/).
// Same split as gen-content-config.mjs — in the monorepo the two coincide.
const CWD = process.cwd();
const PKG = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(CWD, "data/schema.json");
const pagesDir = join(PKG, "frontend/pages");
const manifestPath = join(PKG, "frontend/pages/.generated-routes.json");

// The two name rules live in the checker, so the MCP tool that PROPOSES a route
// refuses exactly what this generator would die on. A route the CMS stores happily
// and the build then rejects is a broken site nobody sees until deploy.
const SEGMENT = ROUTE_SEGMENT;
const RESERVED = RESERVED_ROUTE_BASES;

const die = (msg) => {
  console.error(`gen-routes: ${msg}`);
  process.exit(1);
};

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const site = JSON.parse(readFileSync(join(CWD, "data/site.json"), "utf8"));
const localeCodes = new Set((site.locales || []).map((l) => l.code));

/** Validate one collection's route block; returns the normalized route or null. */
function routeOf(collection) {
  const r = collection.route;
  if (!r) return null;
  const at = `collection "${collection.name}"`;

  if (collection.kind !== "folder") die(`${at} declares a route but is not a folder collection.`);
  if (!SEGMENT.test(r.base || "")) die(`${at} has route.base ${JSON.stringify(r.base)} — must be lowercase kebab-case, one segment.`);
  if (RESERVED.has(r.base)) die(`${at} route.base "${r.base}" is reserved by a built-in route.`);
  if (localeCodes.has(r.base)) die(`${at} route.base "${r.base}" collides with the locale prefix of the same name.`);
  if (!SEGMENT.test(r.template || "")) die(`${at} has route.template ${JSON.stringify(r.template)} — must be lowercase kebab-case.`);
  if (!existsSync(join(CWD, "templates", r.template, "template.html"))) {
    die(`${at} route.template "${r.template}" has no templates/${r.template}/template.html.`);
  }

  let list = null;
  if (r.list) {
    if (!SEGMENT.test(r.list.template || "")) die(`${at} has route.list.template ${JSON.stringify(r.list.template)} — must be lowercase kebab-case.`);
    if (!existsSync(join(CWD, "templates", r.list.template, "template.html"))) {
      die(`${at} route.list.template "${r.list.template}" has no templates/${r.list.template}/template.html.`);
    }
    const sortBy = r.list.sortBy ?? "title";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sortBy)) die(`${at} route.list.sortBy ${JSON.stringify(sortBy)} is not a field name.`);
    if (r.list.order && r.list.order !== "asc" && r.list.order !== "desc") die(`${at} route.list.order must be "asc" or "desc".`);

    // The listing's own text. These values are baked into generated CODE, so they are
    // restricted to primitives — an object or array here would be a shape the template
    // engine cannot print anyway, and a needless widening of what reaches a code position.
    const slots = {};
    for (const [k, v] of Object.entries(r.list.slots || {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) die(`${at} route.list.slots key ${JSON.stringify(k)} is not a field name.`);
      if (v !== null && typeof v === "object") die(`${at} route.list.slots.${k} must be a string, number or boolean.`);
      slots[k] = v;
    }
    list = { template: r.list.template, sortBy, order: r.list.order === "desc" ? "desc" : "asc", slots };
  }
  return { base: r.base, template: r.template, list, localized: collection.localized === true, name: collection.name };
}

const lit = (v) => JSON.stringify(v);
// A JS literal safe to bake into an .astro expression. `<` is escaped so a value can
// never open a tag if this output is ever read in an HTML-ish position.
const jsExpr = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const BANNER = `---
// ⚠️ GENERATED by scripts/gen-routes.mjs from data/schema.json. Do not edit by hand —
// it is regenerated on every build and any edit is lost. Change the collection's
// \`route\` block in the CMS content-type editor (or data/schema.json) instead.`;

/** Detail route at the site root — the default locale. */
function detailRoot(r) {
  return `${BANNER}
import CollectionDetail from "../../components/CollectionDetail.astro";
import { DEFAULT_LOCALE } from "../../lib/i18n";
import { routeEntries } from "../../lib/collection-routes";
import { splitEntries } from "../../lib/paths";

export async function getStaticPaths() {
  const entries = await routeEntries(${lit(r.name)});
  ${
    r.localized
      ? `const { root } = splitEntries(entries);
  return root.map(({ entry, slug }) => ({ params: { slug }, props: { entry } }));`
      : `return entries.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));`
  }
}

const { entry } = Astro.props;
---

<CollectionDetail entry={entry} locale={DEFAULT_LOCALE} template=${lit(r.template)} base=${lit(r.base)} />
`;
}

/** Detail route under a locale prefix. Only for localized collections. */
function detailLocalized(r) {
  return `${BANNER}
import CollectionDetail from "../../../components/CollectionDetail.astro";
import { routeEntries } from "../../../lib/collection-routes";
import { splitEntries } from "../../../lib/paths";

export async function getStaticPaths() {
  const { localized } = splitEntries(await routeEntries(${lit(r.name)}));
  return localized.map(({ entry, locale, slug }) => ({
    params: { locale, slug },
    props: { entry, locale },
  }));
}

const { entry, locale } = Astro.props;
---

<CollectionDetail entry={entry} locale={locale} template=${lit(r.template)} base=${lit(r.base)} />
`;
}

function listRoot(r) {
  return `${BANNER}
import CollectionList from "../../components/CollectionList.astro";
import { DEFAULT_LOCALE } from "../../lib/i18n";
import { routeEntries } from "../../lib/collection-routes";
import { splitEntries } from "../../lib/paths";

const all = await routeEntries(${lit(r.name)});
const entries = ${r.localized ? `splitEntries(all).root.map(({ entry }) => entry)` : `all`};
---

<CollectionList entries={entries} locale={DEFAULT_LOCALE} base=${lit(r.base)} list={${jsExpr(r.list)}} />
`;
}

function listLocalized(r) {
  return `${BANNER}
import CollectionList from "../../../components/CollectionList.astro";
import { otherLocales, splitEntries } from "../../../lib/paths";
import { routeEntries } from "../../../lib/collection-routes";

export async function getStaticPaths() {
  const { localized } = splitEntries(await routeEntries(${lit(r.name)}));
  return otherLocales().map((locale) => ({
    params: { locale },
    props: { locale, entries: localized.filter((e) => e.locale === locale).map(({ entry }) => entry) },
  }));
}

const { locale, entries } = Astro.props;
---

<CollectionList entries={entries} locale={locale} base=${lit(r.base)} list={${jsExpr(r.list)}} />
`;
}

// ── emit ─────────────────────────────────────────────────────────────────────
const routes = (Array.isArray(schema) ? schema : []).map(routeOf).filter(Boolean);

// Two collections claiming one base would silently shadow each other.
const bases = new Map();
for (const r of routes) {
  if (bases.has(r.base)) die(`collections "${bases.get(r.base)}" and "${r.name}" both claim route.base "${r.base}".`);
  bases.set(r.base, r.name);
}

const written = [];
const emit = (rel, source) => {
  const abs = join(pagesDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  written.push(rel);
};

for (const r of routes) {
  emit(`${r.base}/[...slug].astro`, detailRoot(r));
  if (r.list) emit(`${r.base}/index.astro`, listRoot(r));
  if (r.localized) {
    emit(`[locale]/${r.base}/[...slug].astro`, detailLocalized(r));
    if (r.list) emit(`[locale]/${r.base}/index.astro`, listLocalized(r));
  }
}

// Remove files a PREVIOUS run generated that this one did not. Without this, deleting
// a collection's route leaves its pages live forever — the stale-output trap that
// makes generated-into-the-source-tree dangerous.
let previous = [];
try {
  previous = JSON.parse(readFileSync(manifestPath, "utf8")).files || [];
} catch {
  previous = [];
}
const keep = new Set(written);
const touchedDirs = new Set();
for (const rel of previous) {
  if (keep.has(rel)) continue;
  rmSync(join(pagesDir, rel), { force: true });
  touchedDirs.add(dirname(join(pagesDir, rel)));
}
// Then drop any directory the removal left empty. An empty `pages/events/` is not
// merely untidy: it is the visible remains of a route that no longer exists, and the
// next person to look will not know whether the site still serves /events/.
// Deepest-first so pages/[locale]/events/ goes before pages/[locale]/.
for (const dir of [...touchedDirs].sort((a, b) => b.length - a.length)) {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // shared or non-empty — leaving it is the safe outcome
  }
}

writeFileSync(manifestPath, `${JSON.stringify({ files: written.sort() }, null, 2)}\n`);
console.log(
  routes.length
    ? `gen-routes: ${written.length} route file(s) for ${routes.map((r) => `/${r.base}/`).join(", ")}`
    : "gen-routes: no collections declare a route",
);
