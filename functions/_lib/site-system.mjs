// The SITE SYSTEM — the composition rules that make an agent-built site coherent,
// expressed as code so they are checkable instead of remembered.
//
// WHY THIS EXISTS: a person says "I want a simple event site" and an agent has to
// produce a content type, its form fields, a page template, a route and a look —
// five artifacts in four files that only work if they agree with each other. Nothing
// enforced that agreement. A misspelled {{placeholder}} renders empty, a field nobody
// interpolates is dead UI, a collection with no route stores content at no URL, and
// every one of those failures is SILENT: the build passes and the page is just wrong.
//
// So the model is a stack of layers, and the single invariant is:
//
//   A layer may only reference names the layer BELOW it declares.
//
// Everything in this file is one of those cross-layer checks. It is pure (no fs) so
// the CLI (scripts/validate-site.mjs), the test suite, the Astro build and the MCP
// server can all run the SAME code — a second implementation would be a second
// opinion, and the point of the checker is that there is only one.
//
// WHY IT LIVES UNDER functions/: an MCP tool has to be able to refuse a bad template,
// and Cloudflare bundles `functions/` — so the checker has to be reachable from there.
// That imposes two rules on this file, both of which break the DEPLOY (not the tests)
// when violated, because Pages builds with an older esbuild than the local one:
//
//   * no node builtins, and no dependency that is not pure JS — it must run in the
//     Workers runtime. It imports exactly one thing: ./dangerous-constructs.mjs, and
//     through it parse5 (a direct, exact-pinned, pure-JS dep). Verified bundling.
//   * no import attributes (`with { type: "json" }`) anywhere.
//
// Its test deliberately stays at scripts/site-system.test.mjs: everything under
// functions/ is bundled, *.test.mjs included, so a test living here would ship.
//
// ⚠️  The template grammar below MIRRORS frontend/lib/template-render.ts. A checker
// that disagrees with the engine is worse than no checker: it either blesses a broken
// page or blocks a working one. The mirrored parts are marked ENGINE-MIRROR and there
// is a test (site-system.test.mjs) that renders the real manifesto template through
// the real engine and asserts this file reports it clean.

// ── The layers ───────────────────────────────────────────────────────────────
// Ordered bottom-up. Each layer names the artifact that declares it and what the
// layer above is allowed to reference. This list is the doc (docs/site-system.md)
// in machine-readable form; the checks below are its enforcement.
import { dangerousConstructs } from "./dangerous-constructs.mjs";

export const LAYERS = [
  {
    id: "style",
    label: "Style",
    declares: "design tokens (colour, radius, motion, type)",
    artifact: "data/appearance.json + data/styles.json",
  },
  {
    id: "chrome",
    label: "Chrome",
    declares: "header/footer parts",
    artifact: "templates/parts/*.html",
  },
  {
    id: "template",
    label: "Templates",
    declares: "page regions + the slots that fill them",
    artifact: "templates/<name>/{template.html,fields.json}",
  },
  {
    id: "model",
    label: "Content model",
    declares: "collections and their frontmatter fields",
    artifact: "data/schema.json",
  },
  {
    id: "route",
    label: "Routes",
    declares: "the URL a collection's entries render at",
    artifact: "data/schema.json (collection.route) → generated .astro",
  },
  {
    id: "content",
    label: "Content",
    declares: "entries",
    artifact: "content/**/*.md",
  },
];

// Widgets the CMS can render. MIRROR of the `Widget` union in admin/src/schema.ts —
// an unknown widget is an error because FieldInput.vue would render nothing at all.
export const WIDGETS = new Set([
  "string",
  "text",
  "datetime",
  "boolean",
  "number",
  "image",
  "select",
  "relation",
  "object",
  "list",
  "preset",
  "slots",
]);

// Widgets that carry a nested shape, and how the shape is reached.
const NESTS_VIA_FIELDS = new Set(["object", "list"]);

// Names the engine supplies itself inside an {{#each}} — never declared in fields.json.
export const LOOP_VARS = new Set(["@index", "@number"]);

// The reserved top-level slot: the page's sanitized rich body, injected by the build
// when fields.json sets "body": true. Interpolated as {{{ body }}} (triple-brace —
// it is already-sanitized HTML).
export const BODY_SLOT = "body";

// A template is used in one of three POSITIONS, and the position decides what the
// engine puts in scope beyond the template's own declared fields. Getting this wrong
// is the difference between "renders empty forever" and "works", so it is declared
// rather than inferred.
//
//   page   — a page's freeform `slots` (frontend/components/PageArticle.astro)
//   detail — one entry of a routed collection; scope is its FRONTMATTER + url/slug
//            (frontend/lib/collection-routes.ts detailScope)
//   list   — a routed collection's listing; scope is the listing slots + `entries`
//            (collection-routes.ts listScope)
/** Names collection-routes.ts adds to a DETAIL template's scope. */
export const DETAIL_RESERVED = ["url", "slug", "indexUrl"];
/** Names collection-routes.ts adds to a LIST template's scope, besides `entries`. */
export const LIST_RESERVED = ["count", "isEmpty"];
/** Names listScope adds to every item inside {{#each entries}}. */
export const LIST_ITEM_RESERVED = ["url", "slug"];

// The three positions, with what each one puts in scope. This is the source of
// truth for BOTH the check (POSITIONS below) and the published contract, so an
// agent reading /site-system.json is told exactly what checkTemplate enforces.
export const POSITION_INFO = {
  page: {
    scope: "the page's freeform `slots`, as declared by fields.json",
    reserved: [],
    note: 'Also gets `body` when fields.json sets "body": true.',
  },
  detail: {
    scope: "one entry's FRONTMATTER — the collection's fields, not the template's slots",
    reserved: DETAIL_RESERVED,
    note: "Derived from a collection's `route.template`; never guessed.",
  },
  list: {
    scope: "the listing's own slots, plus `entries`",
    reserved: [...LIST_RESERVED, "entries"],
    note:
      "Each item inside {{#each entries}} also gets " +
      LIST_ITEM_RESERVED.map((n) => `\`${n}\``).join(" and ") +
      ". `isEmpty` exists because the engine has no {{else}} — an empty state needs " +
      "a second, opposite {{#if}}.",
  },
};

export const POSITIONS = new Set(Object.keys(POSITION_INFO));

// Fields that exist to CONTROL publishing rather than to be printed. A template is
// not expected to interpolate them, so they are exempt from the unused-field warning —
// otherwise every content type nags about `draft` forever and the warning gets ignored,
// which is how a real dead field slips through.
export const PUBLISHING_FIELDS = new Set(["draft", "seo", "template", "preset", "slots"]);

// The data Base.astro passes to templates/parts/*.html. Parts have NO fields.json —
// their contract is this object, so it is declared here instead.
//
// ⚠️  MIRROR: frontend/layouts/Base.astro `partData`. Edit both together.
export const PART_DATA = {
  scalars: ["homeUrl", "siteName", "year", "headerClass", "footerClass", "showSwitcher"],
  lists: {
    menuHeader: ["label", "url"],
    menuFooter: ["label", "url"],
    locales: ["code", "url", "active", "inactive", "sep"],
  },
};

// ── Template safety ──────────────────────────────────────────────────────────
// A template is raw markup emitted with `set:html` (HtmlTemplate.astro, Base.astro).
// Nothing sanitizes it — unlike a post body, which goes through frontend/lib/sanitize.ts.
// That was always fine, because the template author was a human with repo write access
// who could have committed the same markup directly.
//
// An agent authoring templates over MCP breaks that assumption. It may be acting on
// prompt-injected input, and the origin it would get JS on is the same origin that
// serves /admin and carries the session cookie — so a script in a template is not
// "bad content", it is CMS takeover the next time the owner is signed in.
//
// So findings are CLASSIFIED rather than listed: the same construct is fine from a
// human and refused from an agent, and the two callers need different answers.
// `checkTemplate` reports them all as WARNINGS — a human's own markup must never fail
// their build (the lesson assert-rendered-safe.ts is built around) — and the MCP
// `write_template` tool refuses on the subset named in UNTRUSTED_AUTHOR_CODES.
//
// What is deliberately NOT flagged: a <style> block, and a background-image url() in a
// style attribute. Templates are MADE of those. Flagging them would fire on every
// template that exists, and a check that fires on everything is a check nobody reads.
const SAFETY = [
  {
    code: "template-executes-js",
    matches: (d) =>
      d.kind === "handler" ||
      d.kind === "script-text" ||
      d.kind === "srcdoc" ||
      d.kind === "url-scheme" ||
      (d.kind === "element" && d.tag === "script"),
    why:
      "runs JavaScript on this site's origin — the same origin that serves /admin and " +
      "carries the editor's session cookie",
  },
  {
    code: "template-embeds-document",
    matches: (d) => d.kind === "element" && ["iframe", "frame", "object", "embed"].includes(d.tag),
    why:
      "embeds another document. A same-origin frame is the documented sandbox escape " +
      "(see frontend/lib/sanitize.ts); a third-party one needs the sandbox policy that " +
      "file already works out, which templates do not inherit",
  },
  {
    // NOT a safety finding and deliberately not refused: a relative URL cannot reach
    // code or another origin. It is here because it is SILENT — the link resolves
    // against the page's own directory, so `href="about"` on /services/violin-setup/
    // points at a URL that does not exist, and nothing else in the system says so.
    code: "template-relative-url",
    matches: (d) => d.kind === "url-relative",
    why:
      "is relative, so it resolves against each page's own address rather than the " +
      "site root — write it as `/about` (a dead link is the usual result)",
  },
  {
    code: "template-redirects-visitor",
    matches: (d) => d.kind === "base" || d.kind === "meta-refresh",
    why: "sends every visitor to this page somewhere else, or retargets every relative URL on it",
  },
  {
    code: "template-loads-remote",
    matches: (d) => d.kind === "element" && ["form", "link"].includes(d.tag),
    why:
      "fetches from, or posts to, somewhere off this site. Legitimate for a contact form " +
      "or a webfont, so it is reported and not refused — read it in the diff",
  },
];

/**
 * Codes an UNTRUSTED author (an agent over MCP) may not produce. `template-loads-remote`
 * is deliberately absent: a contact form posting to a form service and a linked webfont
 * are ordinary, and the review surface (docs/review-surface.md) is the control for them.
 * Recorded as an accepted risk in docs/security-model.md §5.
 */
export const UNTRUSTED_AUTHOR_CODES = new Set([
  "template-executes-js",
  "template-embeds-document",
  "template-redirects-visitor",
]);

/**
 * Markup in `html` that a browser would act on, as checker problems.
 *
 * Parsed, never grepped. `<scr<script>ipt>`, an encoded handler, a construct hidden in
 * a comment or an unclosed attribute — a regex loses all of those to the WHATWG
 * tokenizer, which is exactly the history recorded in dangerous-constructs.mjs.
 *
 * @param {string} html
 * @param {string} where
 * @returns {Problem[]}
 */
export function checkTemplateSafety(html, where) {
  const problems = [];
  // A TEMPLATE is not rendered HTML: `href="{{ url }}"` is not a URL yet, and judging it
  // as one flags every link in every template — which is how a safety check gets turned
  // off. So substitute an inert value first, exactly as assert-rendered-safe.ts does for
  // its control render. Root-relative, because that is what these placeholders resolve
  // to, and a bare word in an href is (correctly) treated as suspicious.
  //
  // The substitution is deliberately NOT scheme-shaped, so `href="javascript:{{x}}"`
  // still reads as `javascript:/…` and is still caught. What a VALUE does at render time
  // is a separate check with its own backstop (renderChecked).
  const inert = html.replace(/\{\{\{[^}]*\}\}\}|\{\{[^}]*\}\}/g, "/lanzasafeplaceholder");
  for (const d of dangerousConstructs(inert)) {
    // SVG sprite references (`<use href="#icon">`) are ordinary; a hostile URL on one
    // is already caught as `url-scheme` by the walk itself.
    if (d.kind === "element" && d.tag === "use") continue;
    const rule = SAFETY.find((r) => r.matches(d));
    if (!rule) continue; // <style>, background-image url() — what templates are made of
    problems.push(
      problem(
        "warning",
        rule.code,
        where,
        `${d.detail} ${rule.why}. Safe from a human with repo access; refused from an ` +
          `agent over MCP, which may be acting on injected input.`,
      ),
    );
  }
  return problems;
}

// ── Template grammar (ENGINE-MIRROR) ─────────────────────────────────────────
// Mirrors tokenize() + parse() in frontend/lib/template-render.ts. We keep only what
// a static check needs — block structure and reference paths — and drop the HTML
// position tracking, which exists for escaping decisions the checker does not make.

/** ENGINE-MIRROR of tokenize(): triple-brace first so {{{x}}} isn't mis-split. */
function tokenize(src) {
  return src.split(/(\{\{\{[^}]*\}\}\}|\{\{[^}]*\}\})/);
}

/**
 * Parse a template into nodes: {t:"var"|"raw", path} | {t:"each"|"if", path, body}.
 * Returns `{nodes, unclosed}` — an unterminated block is its own error (the engine
 * silently swallows the rest of the page).
 */
export function parseTemplate(src) {
  const tokens = tokenize(src);
  const unclosed = [];
  const walk = (i, stop) => {
    const nodes = [];
    while (i < tokens.length) {
      const tok = tokens[i];
      const raw = /^\{\{\{\s*(.*?)\s*\}\}\}$/.exec(tok);
      if (raw) {
        nodes.push({ t: "raw", path: raw[1].trim() });
        i++;
        continue;
      }
      const m = /^\{\{\s*(.*?)\s*\}\}$/.exec(tok);
      if (!m) {
        i++;
        continue;
      }
      const inner = m[1];
      if (stop && inner.replace(/\s+/g, "") === stop) return { nodes, next: i + 1, closed: true };
      const each = /^#each\s+(.+)$/.exec(inner);
      const iff = /^#if\s+(.+)$/.exec(inner);
      if (each || iff) {
        const kind = each ? "each" : "if";
        const inner2 = walk(i + 1, each ? "/each" : "/if");
        if (!inner2.closed) unclosed.push(`{{#${kind} ${(each || iff)[1].trim()}}}`);
        nodes.push({ t: kind, path: (each || iff)[1].trim(), body: inner2.nodes });
        i = inner2.next;
        continue;
      }
      // A stray {{/each}} / {{/if}} with no opener: record it, don't crash.
      if (/^\//.test(inner)) {
        nodes.push({ t: "stray", path: inner });
        i++;
        continue;
      }
      nodes.push({ t: "var", path: inner.trim() });
      i++;
    }
    return { nodes, next: i, closed: !stop };
  };
  const { nodes } = walk(0, undefined);
  return { nodes, unclosed };
}

// ── Declared shapes ──────────────────────────────────────────────────────────

/**
 * Turn a fields.json `fields` array into a scope: the set of names declared at this
 * level, plus the nested scope each list/object opens. Mirrors how the CMS stores
 * slots, which is what the engine reads.
 */
export function shapeOfFields(fields) {
  const names = new Set();
  const children = new Map();
  for (const f of fields || []) {
    if (!f || typeof f.name !== "string") continue;
    names.add(f.name);
    if (NESTS_VIA_FIELDS.has(f.widget) && Array.isArray(f.fields)) {
      children.set(f.name, shapeOfFields(f.fields));
    }
    // list-of-variants (`types`): an item's shape is the union of every variant's
    // fields, because the template cannot know which variant it holds.
    if (f.widget === "list" && Array.isArray(f.types)) {
      const merged = { names: new Set(["type"]), children: new Map() };
      for (const v of f.types) {
        const sub = shapeOfFields(v?.fields);
        for (const n of sub.names) merged.names.add(n);
        for (const [k, c] of sub.children) merged.children.set(k, c);
      }
      children.set(f.name, merged);
    }
  }
  return { names, children };
}

/** The scope a part gets (PART_DATA), in the same shape as shapeOfFields(). */
export function shapeOfPartData() {
  const names = new Set(PART_DATA.scalars);
  const children = new Map();
  for (const [list, item] of Object.entries(PART_DATA.lists)) {
    names.add(list);
    children.set(list, { names: new Set(item), children: new Map() });
  }
  return { names, children };
}

// ── Reference checking ───────────────────────────────────────────────────────

/**
 * ENGINE-MIRROR of ownerFrame(): resolve a bare head name from the innermost scope
 * outward. Returns the owning scope's index, or -1.
 */
function ownerIndex(head, stack) {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].names.has(head)) return i;
  return -1;
}

/**
 * One reported failure. Typed here (rather than inline) because the MCP tool and the
 * CLI both filter on `level`, and `astro check` covers this file.
 *
 * @typedef {{ level: "error"|"warning", code: string, where: string, message: string }} Problem
 */

/** @type {(level: "error"|"warning", code: string, where: string, message: string) => Problem} */
const problem = (level, code, where, message) => ({ level, code, where, message });

/**
 * Walk a parsed template against a declared shape, reporting every reference that
 * cannot resolve and collecting every declared name that IS used.
 *
 * `used` is keyed by fully-qualified declaration path ("cards", "cards.heading") so
 * the caller can report fields the template never interpolates.
 */
function walkRefs(nodes, stack, path, ctx) {
  for (const n of nodes) {
    if (n.t === "stray") {
      ctx.problems.push(
        problem("error", "stray-close", ctx.where, `{{${n.path}}} closes a block that was never opened.`),
      );
      continue;
    }
    const head = n.path.split(".")[0];

    // Loop vars are engine-supplied and only exist inside an {{#each}}.
    if (LOOP_VARS.has(n.path)) {
      if (!ctx.inEach) {
        ctx.problems.push(
          problem("error", "loop-var-outside-each", ctx.where, `{{ ${n.path} }} is only defined inside {{#each}}.`),
        );
      }
      continue;
    }
    if (n.path.startsWith("@")) {
      ctx.problems.push(
        problem("error", "unknown-loop-var", ctx.where, `{{ ${n.path} }} is not an engine variable (@index, @number).`),
      );
      continue;
    }

    const owner = ownerIndex(head, stack);
    if (owner < 0) {
      ctx.problems.push(
        problem(
          "error",
          "undeclared-slot",
          ctx.where,
          `{{ ${n.path} }} resolves to nothing — no enclosing scope declares "${head}". ` +
            `Add it to fields.json, or fix the spelling. The engine renders it as empty text.`,
        ),
      );
      continue;
    }

    // Mark the whole dotted chain used, walking the declared children as we go.
    const parts = n.path.split(".");
    let scope = stack[owner];
    let qualified = stack[owner].path ? `${stack[owner].path}.${parts[0]}` : parts[0];
    ctx.used.add(qualified);
    for (let i = 1; i < parts.length; i++) {
      const child = scope.children.get(parts[i - 1]);
      if (!child) break; // a dotted walk into an undeclared shape; not statically knowable
      if (!child.names.has(parts[i])) {
        ctx.problems.push(
          problem(
            "error",
            "undeclared-slot",
            ctx.where,
            `{{ ${n.path} }} — "${parts.slice(0, i).join(".")}" declares no "${parts[i]}".`,
          ),
        );
        break;
      }
      qualified = `${qualified}.${parts[i]}`;
      ctx.used.add(qualified);
      scope = child;
    }

    if (n.t === "each") {
      const child = stack[owner].children.get(head);
      if (!child) {
        ctx.problems.push(
          problem(
            "error",
            "each-over-scalar",
            ctx.where,
            `{{#each ${n.path} }} — "${head}" is not a list of objects. Declare it as a ` +
              `"list" widget with nested "fields"; the engine cannot print a bare string item.`,
          ),
        );
        walkRefs(n.body, stack, path, { ...ctx, inEach: true });
      } else {
        const frame = { ...child, path: qualified };
        walkRefs(n.body, [...stack, frame], qualified, { ...ctx, inEach: true });
      }
      continue;
    }
    if (n.t === "if") walkRefs(n.body, stack, path, ctx);
  }
}

/** Every declared name, fully qualified — used to find fields nothing interpolates. */
function declaredPaths(shape, prefix = "") {
  const out = [];
  for (const name of shape.names) {
    const q = prefix ? `${prefix}.${name}` : name;
    out.push(q);
    const child = shape.children.get(name);
    if (child) out.push(...declaredPaths(child, q));
  }
  return out;
}

// ── Route names ──────────────────────────────────────────────────────────────
// Shared with scripts/gen-routes.mjs, which is the last gate before these values land
// in a directory name and in generated .astro code. Declared HERE so the MCP tool that
// proposes a route refuses the same names the generator would die on — a route the CMS
// happily stores and the build then rejects is a broken site nobody sees until deploy.

/** A URL segment or template folder name: lowercase kebab, one segment. */
export const ROUTE_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Bases the hand-written routes already own. Generating over one produces two Astro
 * pages for a single URL — a build error at best, a silently shadowed route at worst.
 */
export const RESERVED_ROUTE_BASES = new Set([
  "posts",
  "author",
  "category",
  "tag",
  "admin",
  "api",
  "images",
  "_astro",
]);

/**
 * A collection name is emitted as a `const` binding and re-exported by name in the
 * generated content config, so it must be a plain JS identifier.
 * MIRROR of scripts/gen-content-config.mjs's COLLECTION_NAME_RE.
 */
export const COLLECTION_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// ── The check registry ───────────────────────────────────────────────────────
// Every problem code this system can report, and the SILENT failure it stands for.
// It is a registry rather than a comment because three audiences need the same list:
// docs/site-system.md's table, /site-system.json, and the MCP `describe_site_system`
// tool. scripts/site-system.test.mjs scans the source for emitted codes and fails if
// one is missing here — the codes and their explanations cannot drift apart.
//
// `level` is the level the code is reported AT; `failure` is what the reader actually
// wants to know: what the page does when the check is ignored.
export const CHECKS = [
  // Template grammar
  { code: "unclosed-block", level: "error", failure: "{{#each}}/{{#if}} is never closed — the engine drops everything after it." },
  { code: "stray-close", level: "error", failure: "A {{/each}} or {{/if}} that closes nothing." },
  { code: "unknown-loop-var", level: "error", failure: "An @name the engine does not supply (only @index and @number exist)." },
  { code: "loop-var-outside-each", level: "error", failure: "@index/@number used outside a loop, where they are undefined." },
  // Cross-layer references
  { code: "undeclared-slot", level: "error", failure: "A placeholder no enclosing scope declares — renders as empty text, silently." },
  { code: "each-over-scalar", level: "error", failure: "{{#each}} over something that is not a list of objects — renders nothing." },
  { code: "unused-field", level: "warning", failure: "An input the owner fills that appears in no template." },
  // The body slot
  { code: "body-used-undeclared", level: "error", failure: '{{{ body }}} without "body": true — the CMS hides the canvas, so it is always empty.' },
  { code: "body-declared-unused", level: "warning", failure: '"body": true with no {{{ body }}} — a writing canvas whose text goes nowhere.' },
  { code: "raw-non-body", level: "error", failure: "A triple-brace on anything but `body` emits user input UNESCAPED." },
  // fields.json structure
  { code: "bad-field", level: "error", failure: "A fields.json entry is not an object." },
  { code: "bad-field-name", level: "error", failure: "A field name that is not a usable identifier." },
  { code: "duplicate-field", level: "error", failure: "Two fields share a name — one of them can never be addressed." },
  { code: "unknown-widget", level: "error", failure: "A widget the CMS renders no input for." },
  { code: "missing-label", level: "warning", failure: "No label — the CMS shows the raw field name." },
  { code: "select-without-options", level: "error", failure: "A select with nothing to select." },
  { code: "object-without-fields", level: "error", failure: "An object widget with no nested shape." },
  { code: "template-name-mismatch", level: "error", failure: "fields.json `name` disagrees with the folder. A page's `preset` names the FOLDER." },
  { code: "bad-position", level: "error", failure: "A position outside page/detail/list." },
  // Listings
  { code: "listing-undeclared", level: "error", failure: "A list template with no `listing` block — nothing can check what {{#each entries}} prints." },
  { code: "listing-unknown-field", level: "error", failure: "A listing prints a field its collection does not declare." },
  { code: "listing-unknown-collection", level: "error", failure: "`listing.of` names a collection that does not exist." },
  // Template safety — who wrote it decides the severity (see checkTemplateSafety)
  { code: "template-executes-js", level: "warning", failure: "A template runs JS on the origin that serves /admin and carries the session cookie." },
  { code: "template-embeds-document", level: "warning", failure: "A template embeds another document; a same-origin frame is the sandbox escape." },
  { code: "template-redirects-visitor", level: "warning", failure: "A <base> or meta refresh sends every visitor elsewhere." },
  { code: "template-loads-remote", level: "warning", failure: "A form or stylesheet reaching off-site. Legitimate, but worth reading in the diff." },
  { code: "template-relative-url", level: "warning", failure: "A link or image path that is relative, so it resolves against each page's own address — usually a dead link." },
  // Whole-site (checkSite — needs to read the repo, not just one template)
  { code: "schema-invalid", level: "error", failure: "data/schema.json is not a JSON array of collections — the whole model is unreadable." },
  { code: "missing-template", level: "error", failure: "A template folder with no template.html." },
  { code: "missing-fields", level: "error", failure: "A template folder with no fields.json — the CMS would show no inputs." },
  { code: "route-template-missing", level: "error", failure: 'A live URL rendering "Unknown template".' },
];

// ── The published contract ───────────────────────────────────────────────────

/**
 * The whole composition contract, as data. Served at /site-system.json and returned
 * by the MCP `describe_site_system` tool, both from HERE — so what is published can
 * never disagree with what is enforced.
 *
 * The audience is an agent that has been pointed at a site it has never seen and has
 * not read docs/site-system.md. Everything it needs to write a template, declare its
 * fields and give a content type a URL is in this object.
 */
export function siteSystemContract() {
  return {
    version: 1,
    rule: "A layer may only reference names the layer below it declares.",
    why:
      "Lanza's composition failures are SILENT: a misspelled {{placeholder}} renders as " +
      "empty text, a field nobody interpolates is an input filled for nothing, and a " +
      "content type with no route stores entries at no URL. The build passes and the page " +
      "is merely wrong, so the rule is checked rather than remembered.",
    layers: LAYERS,
    positions: Object.entries(POSITION_INFO).map(([id, p]) => ({ id, ...p })),
    widgets: [...WIDGETS],
    nestingWidgets: [...NESTS_VIA_FIELDS],
    reserved: {
      body: BODY_SLOT,
      loopVars: [...LOOP_VARS],
      publishingFields: [...PUBLISHING_FIELDS],
      partData: PART_DATA,
    },
    checks: CHECKS,
    // Named explicitly: an agent that knows this up front writes an acceptable template
    // the first time, instead of discovering the rule by being refused.
    untrustedAuthorRefusals: {
      codes: [...UNTRUSTED_AUTHOR_CODES],
      why:
        "A template is emitted as raw markup — nothing sanitizes it, unlike a post body. " +
        "Its origin also serves /admin and carries the editor's session cookie, so script " +
        "in a template is CMS takeover rather than bad content. A human with repo access " +
        "may write these; an agent writing over MCP may not, because it can be acting on " +
        "injected input. Templates need none of it: the engine renders at BUILD time, so " +
        "listings, galleries, filters and detail pages are structure and CSS.",
    },
    notes: [
      "`template` and `preset` are different things. `template` is the layout variant; " +
        "`preset` names the folder under templates/, and fields.json's `name` must match it.",
      "A template's <style> is emitted globally, not scoped. Namespace every class.",
      "Fields are declared ONCE, in the detail template's fields.json; the collection is " +
        "derived from it. Typing them twice is how they drift.",
      "Parts (templates/parts/*.html) have no fields.json — their scope is `reserved.partData`.",
    ],
  };
}

// ── Layer checks ─────────────────────────────────────────────────────────────

/** Structural validation of one fields.json (before it is compared to any markup). */
export function checkFieldsJson(fields, where) {
  const problems = [];
  const seen = new Set();
  const walk = (list, prefix) => {
    for (const f of list || []) {
      if (!f || typeof f !== "object") {
        problems.push(problem("error", "bad-field", where, `A field entry is not an object.`));
        continue;
      }
      const at = prefix ? `${prefix}.${f.name}` : f.name;
      if (typeof f.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) {
        problems.push(
          problem("error", "bad-field-name", where, `Field name ${JSON.stringify(f.name)} is not a usable identifier.`),
        );
        continue;
      }
      if (seen.has(at)) {
        problems.push(problem("error", "duplicate-field", where, `Two fields are both named "${at}".`));
      }
      seen.add(at);
      if (!WIDGETS.has(f.widget)) {
        problems.push(
          problem("error", "unknown-widget", where, `"${at}" has widget "${f.widget}" — the CMS renders no input for it.`),
        );
      }
      if (typeof f.label !== "string" || !f.label.trim()) {
        problems.push(problem("warning", "missing-label", where, `"${at}" has no label — the CMS shows the raw name.`));
      }
      if (f.widget === "select" && !(Array.isArray(f.options) && f.options.length)) {
        problems.push(problem("error", "select-without-options", where, `"${at}" is a select with no options.`));
      }
      if (f.widget === "object" && !Array.isArray(f.fields)) {
        problems.push(problem("error", "object-without-fields", where, `"${at}" is an object with no nested fields.`));
      }
      if (Array.isArray(f.fields)) walk(f.fields, at);
      if (Array.isArray(f.types)) for (const v of f.types) walk(v?.fields, at);
    }
  };
  walk(fields, "");
  return problems;
}

/**
 * The core cross-layer check: a template's markup against its declared fields.
 *
 * @param {object} t - {name, html, fields, position} where `fields` is the parsed
 *   fields.json and `position` is one of POSITIONS (default "page"). The position
 *   decides which engine-supplied names are in scope — see POSITIONS.
 * @param {object} [world] - {collections: Map<name, Set<fieldName>>} so a listing's
 *   declared item fields can be checked against the collection it lists.
 */
export function checkTemplate(t, world) {
  const where = `templates/${t.name}/`;
  const problems = [];
  const decl = t.fields || {};
  const position = t.position || (decl.listing ? "list" : "page");
  if (!POSITIONS.has(position)) {
    problems.push(problem("error", "bad-position", where, `Unknown template position "${position}".`));
  }

  if (decl.name && decl.name !== t.name) {
    problems.push(
      problem("error", "template-name-mismatch", where, `fields.json says name "${decl.name}" but the folder is "${t.name}". A page's preset names the FOLDER.`),
    );
  }
  problems.push(...checkFieldsJson(decl.fields, `${where}fields.json`));

  const { nodes, unclosed } = parseTemplate(t.html);
  for (const u of unclosed) {
    problems.push(
      problem("error", "unclosed-block", `${where}template.html`, `${u} is never closed — the engine drops everything after it.`),
    );
  }

  const shape = shapeOfFields(decl.fields);
  // The body slot exists at top level only when the template opts in.
  const usesBody = decl.body === true;

  // Engine-supplied names for this position, layered on top of the declared fields.
  const extra = new Set(usesBody ? [BODY_SLOT] : []);
  const extraChildren = new Map();
  if (position === "detail") for (const n of DETAIL_RESERVED) extra.add(n);
  if (position === "list") {
    for (const n of LIST_RESERVED) extra.add(n);
    const listing = decl.listing || {};
    const item = Array.isArray(listing.item) ? listing.item : [];
    if (!Array.isArray(listing.item)) {
      problems.push(
        problem(
          "error",
          "listing-undeclared",
          `${where}fields.json`,
          `A listing template must declare "listing": { "of": "<collection>", "item": [<field names>] } — ` +
            `otherwise nothing can check what {{#each entries}} may print.`,
        ),
      );
    }
    extra.add("entries");
    extraChildren.set("entries", {
      names: new Set([...item, ...LIST_ITEM_RESERVED]),
      children: new Map(),
    });

    // The item fields must actually exist on the collection being listed.
    const known = world?.collections?.get(listing.of);
    if (known) {
      for (const f of item) {
        if (!known.has(f)) {
          problems.push(
            problem(
              "error",
              "listing-unknown-field",
              `${where}fields.json`,
              `listing.item names "${f}", which collection "${listing.of}" does not declare.`,
            ),
          );
        }
      }
    } else if (listing.of && world?.collections) {
      problems.push(
        problem("error", "listing-unknown-collection", `${where}fields.json`, `listing.of names collection "${listing.of}", which does not exist.`),
      );
    }
  }

  const root = {
    names: new Set([...shape.names, ...extra]),
    children: new Map([...shape.children, ...extraChildren]),
    path: "",
  };

  const ctx = { problems, used: new Set(), where: `${where}template.html`, inEach: false };
  walkRefs(nodes, [root], "", ctx);

  problems.push(...checkTemplateSafety(t.html, `${where}template.html`));

  // body:true must actually interpolate the body, and vice versa. A mismatch is not
  // fatal (the page renders) but it means the CMS shows a writing canvas whose text
  // appears nowhere — or hides one the template is asking for.
  const rawBody = JSON.stringify(nodes).includes('"t":"raw","path":"body"');
  if (usesBody && !rawBody) {
    problems.push(
      problem("warning", "body-declared-unused", where, `fields.json sets "body": true but the template never renders {{{ body }}} — the CMS shows a writing canvas that goes nowhere.`),
    );
  }
  if (!usesBody && rawBody) {
    problems.push(
      problem("error", "body-used-undeclared", where, `The template renders {{{ body }}} but fields.json does not set "body": true — the CMS hides the writing canvas, so it is always empty.`),
    );
  }

  // Declared but never interpolated: dead inputs the owner will fill for nothing.
  for (const p of declaredPaths(shape)) {
    if (PUBLISHING_FIELDS.has(p)) continue;
    if (!ctx.used.has(p)) {
      problems.push(
        problem("warning", "unused-field", `${where}fields.json`, `"${p}" is collected by the CMS but never appears in template.html.`),
      );
    }
  }

  // A triple-brace anywhere but `body` emits unescaped user input.
  const rawPaths = [];
  const collectRaw = (ns) => {
    for (const n of ns) {
      if (n.t === "raw" && n.path !== BODY_SLOT) rawPaths.push(n.path);
      if (n.body) collectRaw(n.body);
    }
  };
  collectRaw(nodes);
  for (const p of rawPaths) {
    problems.push(
      problem("error", "raw-non-body", `${where}template.html`, `{{{ ${p} }}} emits a slot value UNESCAPED. Only {{{ body }}} is safe — it is sanitized upstream. Use {{ ${p} }}.`),
    );
  }

  return problems;
}

/** A header/footer part against the data Base.astro actually supplies. */
export function checkPart(name, html) {
  const where = `templates/parts/${name}.html`;
  const problems = [];
  const { nodes, unclosed } = parseTemplate(html);
  for (const u of unclosed) {
    problems.push(problem("error", "unclosed-block", where, `${u} is never closed.`));
  }
  const shape = shapeOfPartData();
  const ctx = { problems, used: new Set(), where, inEach: false };
  walkRefs(nodes, [{ ...shape, path: "" }], "", ctx);
  // Parts are templates too, and an agent can write them.
  problems.push(...checkTemplateSafety(html, where));
  return problems;
}

// ── The whole-site check ─────────────────────────────────────────────────────

/**
 * Check every layer of a site against every other one — the thing `npm run check:site`
 * and the MCP `validate_site` tool both run.
 *
 * IO is injected rather than imported, for the reason this file has no dependencies:
 * the CLI reads a working tree with node's fs, and the MCP server reads a GitHub
 * branch over HTTP. Sharing the orchestration means the answer an agent gets from the
 * server is the answer the CLI would give — a second implementation would be a second
 * opinion, and there is only supposed to be one.
 *
 * @param {object} io
 * @param {(path: string) => Promise<string|null>|string|null} io.readText
 *   Repo-relative read. Null (not a throw) when the file does not exist.
 * @param {() => Promise<string[]>|string[]} io.listTemplates
 *   Every folder name under templates/, EXCLUDING `parts`.
 * @param {object} [opts]
 * @param {number} [opts.maxTemplates]
 *   Read at most this many template folders. Exists because a Cloudflare Worker gets
 *   ~50 subrequests per request and each template costs two reads; whatever is left
 *   out comes back in `skipped` rather than being silently dropped.
 * @param {string[]} [opts.only] Validate just these template folders.
 * @returns {Promise<{problems: Problem[], templates: string[], skipped: string[]}>}
 */
export async function checkSite(io, opts = {}) {
  const problems = [];
  const readText = async (p) => (await io.readText(p)) ?? null;

  // ── The model, and the routes that give it URLs.
  let folders = [];
  const schemaRaw = await readText("data/schema.json");
  if (schemaRaw !== null) {
    let schema;
    try {
      schema = JSON.parse(schemaRaw);
    } catch (e) {
      schema = null;
      problems.push(problem("error", "schema-invalid", "data/schema.json", `Not valid JSON: ${e.message}`));
    }
    if (schema !== null && !Array.isArray(schema)) {
      problems.push(
        problem("error", "schema-invalid", "data/schema.json", "Expected an array of collections."),
      );
    } else if (Array.isArray(schema)) {
      folders = schema.filter((c) => c && c.kind === "folder");
    }
  }

  const world = {
    collections: new Map(folders.map((c) => [c.name, new Set((c.fields || []).map((f) => f.name))])),
  };

  // A template's POSITION comes from the routes that reference it — never guessed,
  // because the position decides what the engine puts in scope.
  const position = new Map();
  for (const c of folders) {
    if (c.route?.template) position.set(c.route.template, "detail");
    if (c.route?.list?.template) position.set(c.route.list.template, "list");
  }

  // ── Templates.
  const all = (await io.listTemplates()).filter((n) => n !== "parts");
  const wanted = opts.only ? all.filter((n) => opts.only.includes(n)) : all;
  for (const name of opts.only || []) {
    if (!all.includes(name)) {
      problems.push(problem("error", "missing-template", `templates/${name}/`, "No such template folder."));
    }
  }
  const limit = opts.maxTemplates ?? Infinity;
  const templates = wanted.slice(0, limit);
  const skipped = wanted.slice(limit);

  for (const name of templates) {
    const html = await readText(`templates/${name}/template.html`);
    if (html === null) {
      problems.push(problem("error", "missing-template", `templates/${name}/`, "No template.html."));
      continue;
    }
    const fieldsRaw = await readText(`templates/${name}/fields.json`);
    if (fieldsRaw === null) {
      problems.push(
        problem("error", "missing-fields", `templates/${name}/`, "No fields.json — the CMS would show no inputs for this template."),
      );
      continue;
    }
    let fields;
    try {
      fields = JSON.parse(fieldsRaw);
    } catch (e) {
      problems.push(problem("error", "bad-field", `templates/${name}/fields.json`, `Not valid JSON: ${e.message}`));
      continue;
    }
    problems.push(...checkTemplate({ name, html, fields, position: position.get(name) }, world));
  }

  // ── Chrome. Parts have no fields.json; their contract is PART_DATA.
  for (const part of ["header", "footer"]) {
    const html = await readText(`templates/parts/${part}.html`);
    if (html !== null) problems.push(...checkPart(part, html));
  }

  // ── Routes. Checked against the FULL listing, not the capped one: a route into a
  // template we simply didn't read is not a missing template.
  const exists = new Set(all);
  for (const c of folders) {
    for (const t of [c.route?.template, c.route?.list?.template].filter(Boolean)) {
      if (!exists.has(t)) {
        problems.push(
          problem("error", "route-template-missing", "data/schema.json", `collection "${c.name}" routes to template "${t}", which does not exist.`),
        );
      }
    }
  }

  return { problems, templates, skipped };
}

export default {
  LAYERS,
  checkSite,
  ROUTE_SEGMENT,
  RESERVED_ROUTE_BASES,
  checkTemplateSafety,
  UNTRUSTED_AUTHOR_CODES,
  WIDGETS,
  CHECKS,
  siteSystemContract,
  parseTemplate,
  shapeOfFields,
  checkTemplate,
  checkPart,
  checkFieldsJson,
};
