// Page listings with a formatted date and a "latest N / the rest" split
// (functions/_lib/listing-scope.mjs). One module feeds the build, the CMS preview and
// the checker, so these pin the module, the checker's view of it, and that the real
// engine renders what the checker blesses — escaped, with provenance.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  listingOptionErrors,
  dateOf,
  longDate,
  listingItem,
  listingParts,
  LATEST_MAX,
} from "../functions/_lib/listing-scope.mjs";
import { checkTemplate } from "../functions/_lib/site-system.mjs";
import { render } from "../frontend/lib/template-render.ts";
import { fieldRecords } from "../frontend/lib/provenance/text.mjs";

const LISTING = { of: "posts", item: ["title", "description"], sortBy: "pubDate", order: "desc", date: "pubDate", latest: 2 };

describe("options", () => {
  test("accepts the documented shape and no options at all", () => {
    assert.deepEqual(listingOptionErrors(LISTING), []);
    assert.deepEqual(listingOptionErrors({ of: "posts", item: [] }), []);
  });
  for (const [name, extra] of [
    ["a zero latest", { latest: 0 }],
    ["a fractional latest", { latest: 1.5 }],
    ["a string latest", { latest: "2" }],
    ["a latest past the cap", { latest: LATEST_MAX + 1 }],
    ["a date that is not a field name", { date: "pub-date" }],
    ["a non-string date", { date: ["pubDate"] }],
  ]) {
    test(`refuses ${name}`, () => assert.equal(listingOptionErrors({ ...LISTING, ...extra }).length, 1));
  }
});

describe("dates", () => {
  test("reads Date values and ISO strings from JSON frontmatter, nothing else", () => {
    assert.equal(dateOf(new Date("2026-06-09T00:00:00Z")).toISOString(), "2026-06-09T00:00:00.000Z");
    assert.equal(dateOf("2026-06-09T00:00:00Z").toISOString(), "2026-06-09T00:00:00.000Z");
    for (const v of ["June 9", "2026-13-45", 20260609, null, new Date("x")]) assert.equal(dateOf(v), null);
  });
  test("formats a long date in the page's language, in UTC", () => {
    const d = new Date("2026-06-09T00:00:00Z");
    assert.equal(longDate(d, "en"), "June 9, 2026");
    assert.equal(longDate(d, "es"), "9 de junio de 2026");
    assert.equal(longDate(d, "not a locale!"), "2026-06-09");
  });
  test("an item gets date and dateLong only when listing.date is set and present", () => {
    const data = { title: "A", description: "d", pubDate: "2026-06-09T00:00:00Z", secret: "x" };
    assert.deepEqual(listingItem(data, LISTING, "en"), { title: "A", description: "d", date: "2026-06-09", dateLong: "June 9, 2026" });
    assert.deepEqual(listingItem(data, { item: ["title"] }, "en"), { title: "A" });
    assert.deepEqual(listingItem({ title: "B" }, LISTING, "en"), { title: "B", description: undefined });
  });
});

describe("split", () => {
  const items = ["a", "b", "c"].map((title) => ({ title, lanzaProvenance: { version: 1, fields: { title: { origin: "agent", text: title } } } }));

  test("latest holds the first N, rest the others, with paired flags", () => {
    const { scope } = listingParts(items, LISTING, fieldRecords);
    assert.deepEqual(scope.latest.map((i) => i.title), ["a", "b"]);
    assert.deepEqual(scope.rest.map((i) => i.title), ["c"]);
    assert.equal(scope.count, 3);
    assert.deepEqual([scope.isEmpty, scope.latestIsEmpty, scope.restIsEmpty], [false, false, false]);
    const short = listingParts(items.slice(0, 1), LISTING, fieldRecords).scope;
    assert.deepEqual([short.latest.length, short.rest.length, short.restIsEmpty], [1, 0, true]);
    const none = listingParts([], LISTING, fieldRecords).scope;
    assert.deepEqual([none.isEmpty, none.latestIsEmpty, none.restIsEmpty], [true, true, true]);
  });

  test("without latest the scope is exactly the old one", () => {
    assert.deepEqual(Object.keys(listingParts(items, { item: ["title"] }, fieldRecords).scope), ["entries", "count", "isEmpty"]);
  });

  // The engine resolves provenance by the path it computes inside each loop.
  test("provenance is keyed for every list the template can loop over", () => {
    const { fields } = listingParts(items, LISTING, fieldRecords);
    for (const path of ["entries.2.title", "latest.1.title", "rest.0.title"]) assert.ok(fields[path], path);
  });
});

describe("checker and engine agree", () => {
  const html =
    `<h1>{{ heading }}</h1>{{#each latest}}<a href="{{ url }}">{{ title }}</a><time datetime="{{ date }}">{{ dateLong }}</time>{{/each}}` +
    `{{#if rest}}<h2>{{ archiveHeading }}</h2>{{/if}}{{#each rest}}<a href="{{ url }}">{{ title }}</a>{{/each}}` +
    `{{#if isEmpty}}<p>Nothing yet.</p>{{/if}}`;
  const fields = (listing) => ({
    name: "insights",
    listing,
    fields: [{ name: "heading", label: "Heading", widget: "string" }, { name: "archiveHeading", label: "Archive heading", widget: "string" }],
  });
  const world = { collections: new Map([["posts", new Set(["title", "description", "pubDate"])]]) };
  const errors = (listing, position) =>
    checkTemplate({ name: "insights", html, fields: fields(listing), position }, world).filter((p) => p.level === "error").map((p) => p.code);

  test("a page listing with date and latest checks clean", () => {
    assert.deepEqual(errors(LISTING), []);
  });

  test("without latest or date, the same markup names slots nothing supplies", () => {
    assert.ok(errors({ ...LISTING, latest: undefined }).includes("undeclared-slot"));
    assert.ok(errors({ ...LISTING, date: undefined }).includes("undeclared-slot"));
  });

  test("refuses bad options, an unknown date field, and options on a route.list template", () => {
    assert.ok(errors({ ...LISTING, latest: 0 }).includes("listing-invalid"));
    assert.ok(errors({ ...LISTING, date: "publishedOn" }).includes("listing-unknown-field"));
    assert.ok(errors(LISTING, "list").includes("listing-invalid"));
  });

  test("the engine renders the split, the long date, escaping and agent spans", () => {
    const posts = [
      { title: "New <b>", pubDate: "2026-06-09T00:00:00Z", lanzaProvenance: { version: 1, fields: { title: { origin: "agent", text: "New <b>" } } } },
      { title: "Mid", pubDate: "2026-05-01T00:00:00Z" },
      { title: "Old", pubDate: "2025-01-01T00:00:00Z" },
    ].map((data, i) => ({ ...listingItem(data, LISTING, "en"), lanzaProvenance: data.lanzaProvenance, slug: `p${i}`, url: `/p${i}/` }));
    const { scope, fields } = listingParts(posts, LISTING, fieldRecords);
    const out = render(html, { heading: "Insights", archiveHeading: "From the archive", ...scope, lanzaProvenance: { version: 1, fields } });
    assert.match(out, /<a href="\/p0\/"><span data-lanza-origin="agent">New &lt;b&gt;<\/span><\/a><time datetime="2026-06-09">June 9, 2026<\/time>/);
    assert.ok(out.indexOf("Mid") < out.indexOf("From the archive") && out.indexOf("From the archive") < out.indexOf("Old"));
    assert.doesNotMatch(out, /<b>|Nothing yet/);
  });
});
