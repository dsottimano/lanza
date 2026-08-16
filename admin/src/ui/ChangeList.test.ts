import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ChangeList from "./ChangeList.vue";
import type { EntryDiff, FieldDiff } from "../backend/entry-diff";
import type { Field } from "../schema";

const PATH = "content/pages/en/about.md";

function diffOf(status: EntryDiff["status"], fields: FieldDiff[]): EntryDiff {
  return { path: PATH, status, fields };
}

// The page's declared model: a scalar, and a template slot list whose items have
// their own fields — the shape a `slots.cards.0.heading` path has to resolve against.
const pageFields: Field[] = [
  { name: "title", label: "Title", widget: "string" },
  {
    name: "slots",
    label: "Page sections",
    widget: "slots",
    fields: [
      {
        name: "cards",
        label: "Cards",
        widget: "list",
        fields: [{ name: "heading", label: "Heading", widget: "string" }],
      },
    ],
  },
];

const mountList = (diff: EntryDiff, fields?: Field[]) =>
  mount(ChangeList, { props: { diff, fields } });

describe("ChangeList — the rows", () => {
  const mixed = diffOf("changed", [
    { path: "title", status: "changed", live: "About", staged: "About us" },
    { path: "subtitle", status: "unchanged", live: "Same", staged: "Same" },
    { path: "hero", status: "added", live: undefined, staged: "/x.jpg" },
  ]);

  it("renders the changed fields and leaves the unchanged one out", () => {
    const w = mountList(mixed);
    const text = w.text();
    expect(text).toContain("About us");
    expect(text).toContain("/x.jpg");
    // The unchanged field must not appear at all — a review screen that lists
    // everything is the file, not a review.
    expect(text).not.toContain("Same");
    expect(w.findAll("li")).toHaveLength(2);
  });

  it("shows both sides of a change, and marks a side that isn't there", () => {
    const w = mountList(mixed);
    const rows = w.findAll("li");
    expect(rows[0].text()).toContain("About");
    expect(rows[0].text()).toContain("About us");
    // `hero` is new: there is no live value, and saying "not set" beats a blank.
    expect(rows[1].text()).toContain("not set");
  });

  it("counts what would change", () => {
    expect(mountList(mixed).text()).toContain("2 fields would change");
  });
});

describe("ChangeList — labels", () => {
  const slotDiff = diffOf("changed", [
    { path: "slots.cards.0.heading", status: "changed", live: "One", staged: "Uno" },
  ]);

  it("resolves a nested list path against the declared fields, counting items from 1", () => {
    const w = mountList(slotDiff, pageFields);
    expect(w.text()).toContain("Page sections › Cards › item 1 › Heading");
  });

  it("falls back to the raw path when nothing declares the field", () => {
    // A template's slots are declared in the template's own fields.json, so the
    // collection's fields often don't describe them. An honest path beats a
    // label we made up.
    const w = mountList(slotDiff);
    expect(w.text()).toContain("slots.cards.0.heading");
  });

  it("keeps the raw path as the row's title attribute, whatever the label says", () => {
    const w = mountList(slotDiff, pageFields);
    expect(w.find("li button").attributes("title")).toBe("slots.cards.0.heading");
  });

  it("calls the body what the writer calls it", () => {
    const w = mountList(
      diffOf("changed", [{ path: "body", status: "changed", live: "a", staged: "b" }]),
    );
    expect(w.text()).toContain("Page content");
  });
});

describe("ChangeList — readable values", () => {
  it("summarizes a container instead of dumping JSON at the reviewer", () => {
    const w = mountList(
      diffOf("changed", [
        {
          path: "slots",
          status: "added",
          live: undefined,
          staged: { cards: [{ heading: "One" }, { heading: "Two" }] },
        },
        { path: "tags", status: "added", live: undefined, staged: ["a", "b", "c"] },
      ]),
    );
    const text = w.text();
    expect(text).toContain("1 field");
    expect(text).toContain("3 items");
    expect(text).not.toContain("{");
    expect(text).not.toContain("heading");
  });

  it("strips markup and truncates long prose", () => {
    const long = `<p>${"word ".repeat(60)}</p>`;
    const w = mountList(
      diffOf("changed", [{ path: "body", status: "changed", live: "<p>Old.</p>", staged: long }]),
    );
    const text = w.text();
    expect(text).toContain("Old.");
    expect(text).not.toContain("<p>");
    expect(text).toContain("…");
    // Truncated, not the whole 300 characters.
    expect(text.length).toBeLessThan(400);
  });

  it("renders a boolean and a date as words, not raw values", () => {
    const w = mountList(
      diffOf("changed", [
        { path: "draft", status: "changed", live: true, staged: false },
        {
          path: "publishDate",
          status: "changed",
          live: new Date("2026-08-15T00:00:00Z"),
          staged: new Date("2026-08-16T00:00:00Z"),
        },
      ]),
    );
    const text = w.text();
    expect(text).toContain("Yes");
    expect(text).toContain("No");
    expect(text).toContain("2026-08-16");
  });
});

describe("ChangeList — events", () => {
  const diff = diffOf("changed", [
    { path: "title", status: "changed", live: "About", staged: "About us" },
    { path: "slots.cards.0.heading", status: "changed", live: "One", staged: "Uno" },
  ]);

  it("emits select with the path of the row that was clicked", async () => {
    const w = mountList(diff);
    await w.findAll("li")[1].find("button").trigger("click");
    expect(w.emitted("select")).toEqual([["slots.cards.0.heading"]]);
  });

  it("emits revert with that row's path, and does not also select", async () => {
    const w = mountList(diff);
    const revert = w.findAll("li")[0].findAll("button")[1];
    expect(revert.text()).toBe("Revert");
    await revert.trigger("click");
    expect(w.emitted("revert")).toEqual([["title"]]);
    // The two buttons are siblings, so reverting never doubles as a selection.
    expect(w.emitted("select")).toBeUndefined();
  });

  it("emits nothing beyond the two documented events", async () => {
    const w = mountList(diff);
    await w.findAll("li")[0].find("button").trigger("click");
    // `click` is the native DOM event bubbling up to the root element, which
    // test-utils records too — it isn't something this component emits.
    const emitted = Object.keys(w.emitted()).filter((e) => e !== "click");
    expect(emitted).toEqual(["select"]);
  });

  // A field revert means "put the live value back". On a page that was never
  // published there is no live value (that revert is a delete), and on one staging
  // deleted there is no staged file to put it into.
  it("offers no revert where reverting one field has no meaning", () => {
    const newPage = diffOf("new", [
      { path: "title", status: "added", live: undefined, staged: "Brand new" },
    ]);
    expect(mountList(newPage).text()).not.toContain("Revert");

    const gone = diffOf("deleted", [
      { path: "title", status: "removed", live: "Retired", staged: undefined },
    ]);
    expect(mountList(gone).text()).not.toContain("Revert");
  });
});

describe("ChangeList — entry-level states", () => {
  it("says a new page has never been published", () => {
    const w = mountList(
      diffOf("new", [{ path: "title", status: "added", live: undefined, staged: "Brand new" }]),
    );
    expect(w.text()).toContain("never been published");
    // The rows still render: reviewing a new page means reading it.
    expect(w.findAll("li")).toHaveLength(1);
  });

  it("says a deleted page would come down", () => {
    const w = mountList(
      diffOf("deleted", [{ path: "title", status: "removed", live: "Retired", staged: undefined }]),
    );
    expect(w.text()).toContain("takes it down");
    expect(w.findAll("li")[0].text()).toContain("removed");
  });

  it("says there is nothing to publish when the page matches production", () => {
    const w = mountList(
      diffOf("unchanged", [{ path: "title", status: "unchanged", live: "About", staged: "About" }]),
    );
    expect(w.text()).toContain("Nothing to publish");
    expect(w.findAll("li")).toHaveLength(0);
  });

  it("says so when the page is on neither branch", () => {
    const w = mountList(diffOf("absent", []));
    expect(w.text()).toContain("isn't on the live site");
    expect(w.findAll("li")).toHaveLength(0);
  });
});
