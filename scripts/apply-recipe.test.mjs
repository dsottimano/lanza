// apply-recipe end to end, against a throwaway tenant.
//
// The property that matters most is the LAST test: a recipe with one bad placeholder
// must write NOTHING. A half-applied recipe leaves a content type whose template does
// not exist — a site that is broken in a way neither the owner nor the agent can see,
// which is worse than the recipe having failed outright.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = join(ROOT, "scripts/apply-recipe.mjs");
const RECIPE = join(ROOT, "recipes/event-site");

let tenant;

/** A minimal but realistic tenant: the three data files apply-recipe reads. */
function makeTenant() {
  const dir = mkdtempSync(join(tmpdir(), "lanza-recipe-"));
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "data/schema.json"), JSON.stringify([{ kind: "folder", name: "pages", label: "Pages", labelSingular: "Page", folder: "content/pages", body: "rich", fields: [] }], null, 2));
  writeFileSync(join(dir, "data/site.json"), JSON.stringify({ locales: [{ code: "en" }, { code: "es" }], defaultLocale: "en" }));
  writeFileSync(join(dir, "data/menu.en.json"), JSON.stringify({ header: [{ label: "Home", url: "/" }], footer: [] }));
  return dir;
}

const run = (args, opts = {}) => execFileSync(process.execPath, [APPLY, ...args], { encoding: "utf8", ...opts });

before(() => {
  tenant = makeTenant();
  run([RECIPE, "--into", tenant]);
});
after(() => rmSync(tenant, { recursive: true, force: true }));

describe("applying the event-site recipe", () => {
  test("copies both templates into the tenant", () => {
    for (const t of ["event", "event-index"]) {
      assert.ok(existsSync(join(tenant, "templates", t, "template.html")), `${t}/template.html`);
      assert.ok(existsSync(join(tenant, "templates", t, "fields.json")), `${t}/fields.json`);
    }
  });

  test("adds the events collection without disturbing what was there", () => {
    const schema = JSON.parse(readFileSync(join(tenant, "data/schema.json"), "utf8"));
    assert.ok(schema.some((c) => c.name === "pages"), "the existing collection survives");
    const events = schema.find((c) => c.name === "events");
    assert.ok(events, "events collection added");
    assert.equal(events.kind, "folder");
    assert.equal(events.folder, "content/events");
    assert.equal(events.localized, true);
    assert.equal(events.body, "rich");
  });

  test("derives the collection's fields from the template — declared once, not twice", () => {
    const schema = JSON.parse(readFileSync(join(tenant, "data/schema.json"), "utf8"));
    const events = schema.find((c) => c.name === "events");
    const fromTemplate = JSON.parse(readFileSync(join(RECIPE, "templates/event/fields.json"), "utf8")).fields;
    assert.deepEqual(events.fields, fromTemplate);
    assert.ok(events.fields.some((f) => f.name === "startDate" && f.widget === "datetime"));
  });

  test("declares the route, with the listing's defaults captured as slots", () => {
    const events = JSON.parse(readFileSync(join(tenant, "data/schema.json"), "utf8")).find((c) => c.name === "events");
    assert.equal(events.route.base, "events");
    assert.equal(events.route.template, "event");
    assert.equal(events.route.list.template, "event-index");
    assert.equal(events.route.list.sortBy, "startDate");
    assert.equal(events.route.list.order, "asc");
    assert.equal(events.route.list.slots.heading, "What's on");
    assert.ok(events.route.list.slots.emptyText, "the empty state is carried over");
    assert.ok(!("slotsFrom" in events.route.list), "slotsFrom is resolved away, not shipped");
  });

  test("seeds the sample events", () => {
    assert.ok(existsSync(join(tenant, "content/events/en/spring-open-studio.md")));
    assert.match(readFileSync(join(tenant, "content/events/en/makers-market.md"), "utf8"), /soldOut: true/);
  });

  test("writes the style variants and adds the menu link once", () => {
    const styles = JSON.parse(readFileSync(join(tenant, "data/styles.json"), "utf8"));
    assert.equal(styles.variants.length, 3);
    const menu = JSON.parse(readFileSync(join(tenant, "data/menu.en.json"), "utf8"));
    assert.equal(menu.header.filter((h) => h.url === "/events/").length, 1);
    assert.ok(menu.header.some((h) => h.url === "/"), "the existing menu item survives");
  });

  test("is idempotent-ish: re-applying without --force refuses rather than duplicating", () => {
    assert.throws(() => run([RECIPE, "--into", tenant], { stdio: "pipe" }), /already has a collection named "events"/);
  });

  test("--dry-run reports the same writes but changes nothing", () => {
    const fresh = makeTenant();
    const before = readFileSync(join(fresh, "data/schema.json"), "utf8");
    const out = run([RECIPE, "--into", fresh, "--dry-run"]);
    assert.match(out, /would write templates\/event\/template\.html/);
    assert.equal(readFileSync(join(fresh, "data/schema.json"), "utf8"), before);
    assert.ok(!existsSync(join(fresh, "templates")));
    rmSync(fresh, { recursive: true, force: true });
  });
});

describe("a broken recipe is refused whole", () => {
  test("one bad placeholder blocks the apply, and nothing is written", () => {
    const fresh = makeTenant();
    const broken = mkdtempSync(join(tmpdir(), "lanza-broken-"));
    cpSync(RECIPE, broken, { recursive: true });

    // A single typo in the detail template — the failure mode this whole system
    // exists to catch, because the engine renders it as empty text and says nothing.
    const tpl = join(broken, "templates/event/template.html");
    writeFileSync(tpl, readFileSync(tpl, "utf8").replace("{{ venue }}", "{{ vneue }}"));

    assert.throws(() => run([broken, "--into", fresh], { stdio: "pipe" }), /undeclared-slot|error/);
    assert.ok(!existsSync(join(fresh, "templates")), "no templates written");
    assert.ok(!existsSync(join(fresh, "content")), "no content written");
    const schema = JSON.parse(readFileSync(join(fresh, "data/schema.json"), "utf8"));
    assert.ok(!schema.some((c) => c.name === "events"), "no collection written");

    rmSync(fresh, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
  });
});
