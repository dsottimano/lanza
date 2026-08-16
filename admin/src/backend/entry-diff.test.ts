import { describe, it, expect } from "vitest";
import { reactive, isReactive } from "vue";
import { loadEntryDiff, changedPaths, revertValue, BODY_FIELD, type FieldDiff } from "./entry-diff";
import { GitHubError, type GitHubClient } from "./github";
import { REPO } from "./config";

const PATH = "content/pages/en/about.md";

/**
 * A GitHubClient that serves one file per ref and 404s for the refs that don't
 * have it — the shape `loadText` sees. `undefined` for a ref means "not there".
 * A number instead of text is the HTTP status to fail with, for the 404-vs-500 case.
 */
function spyClient(files: { live?: string | number; staged?: string | number }) {
  const reads: string[] = [];
  const client = {
    loadText: async (path: string, ref: string) => {
      reads.push(`${ref}:${path}`);
      const file = ref === REPO.productionBranch ? files.live : files.staged;
      if (file === undefined) throw new GitHubError(404, "Not Found");
      if (typeof file === "number") throw new GitHubError(file, "Server Error");
      return { path, sha: `sha-${ref}`, text: file };
    },
  } as unknown as GitHubClient;
  return { client, reads };
}

function file(frontmatter: string, body = "Hello."): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

/** The one row for `path`, so an assertion names the field it's about. */
function at(fields: FieldDiff[], path: string): FieldDiff | undefined {
  return fields.find((f) => f.path === path);
}

describe("loadEntryDiff", () => {
  it("reads the same path from production and staging", async () => {
    const { client, reads } = spyClient({ live: file("title: A"), staged: file("title: A") });
    await loadEntryDiff(client, PATH);
    expect(reads.sort()).toEqual(
      [`${REPO.branch}:${PATH}`, `${REPO.productionBranch}:${PATH}`].sort(),
    );
  });

  it("reports an identical file as unchanged, fields and all", async () => {
    const raw = file("title: About\ndraft: false");
    const { client } = spyClient({ live: raw, staged: raw });
    const diff = await loadEntryDiff(client, PATH);
    expect(diff.status).toBe("unchanged");
    expect(diff.fields.map((f) => f.path)).toEqual(["title", "draft", BODY_FIELD]);
    expect(diff.fields.every((f) => f.status === "unchanged")).toBe(true);
  });

  it("reports a scalar change with both sides", async () => {
    const { client } = spyClient({
      live: file("title: About\ndraft: true"),
      staged: file("title: About us\ndraft: true"),
    });
    const diff = await loadEntryDiff(client, PATH);
    expect(diff.status).toBe("changed");
    expect(changedPaths(diff)).toEqual(["title"]);
    expect(at(diff.fields, "title")).toMatchObject({
      status: "changed",
      live: "About",
      staged: "About us",
    });
  });

  it("reports an added and a removed frontmatter key", async () => {
    const { client } = spyClient({
      live: file("title: About\nsubtitle: Old"),
      staged: file("title: About\nhero: /images/uploads/x.jpg"),
    });
    const diff = await loadEntryDiff(client, PATH);
    expect(at(diff.fields, "subtitle")).toMatchObject({
      status: "removed",
      live: "Old",
      staged: undefined,
    });
    expect(at(diff.fields, "hero")).toMatchObject({
      status: "added",
      live: undefined,
      staged: "/images/uploads/x.jpg",
    });
  });

  it("descends into nested objects and names the leaf, not the branch", async () => {
    const { client } = spyClient({
      live: file("seo:\n  title: A\n  description: same"),
      staged: file("seo:\n  title: B\n  description: same"),
    });
    const diff = await loadEntryDiff(client, PATH);
    expect(changedPaths(diff)).toEqual(["seo.title"]);
    expect(at(diff.fields, "seo.description")?.status).toBe("unchanged");
    // The container itself never gets a row of its own while it has leaves.
    expect(at(diff.fields, "seo")).toBeUndefined();
  });

  // The path this module exists to produce: `slots` is the template's editable
  // content (ui/TemplateEditor.vue), and the path must be the one a template
  // placeholder resolves — see resolve() in frontend/lib/template-render.ts.
  it("indexes list items so the path matches a template slot path", async () => {
    const cards = (second: string) =>
      file(`preset: manifesto\nslots:\n  cards:\n    - heading: One\n    - heading: ${second}`);
    const { client } = spyClient({ live: cards("Two"), staged: cards("Deux") });
    const diff = await loadEntryDiff(client, PATH);
    expect(changedPaths(diff)).toEqual(["slots.cards.1.heading"]);
  });

  it("reports an appended list item as added and a dropped one as removed", async () => {
    const { client } = spyClient({
      live: file("slots:\n  cards:\n    - heading: One"),
      staged: file("slots:\n  cards:\n    - heading: One\n    - heading: Two"),
    });
    const added = await loadEntryDiff(client, PATH);
    expect(at(added.fields, "slots.cards.1")).toMatchObject({
      status: "added",
      live: undefined,
      staged: { heading: "Two" },
    });

    const { client: back } = spyClient({
      live: file("slots:\n  cards:\n    - heading: One\n    - heading: Two"),
      staged: file("slots:\n  cards:\n    - heading: One"),
    });
    const removed = await loadEntryDiff(back, PATH);
    expect(at(removed.fields, "slots.cards.1")).toMatchObject({
      status: "removed",
      live: { heading: "Two" },
      staged: undefined,
    });
  });

  // Order IS the layout for page blocks, so a swap must not read as unchanged.
  it("treats a reordered list as changed at every moved index", async () => {
    const { client } = spyClient({
      live: file("blocks:\n  - a\n  - b"),
      staged: file("blocks:\n  - b\n  - a"),
    });
    const diff = await loadEntryDiff(client, PATH);
    expect(changedPaths(diff)).toEqual(["blocks.0", "blocks.1"]);
    expect(at(diff.fields, "blocks.0")).toMatchObject({ live: "a", staged: "b" });
  });

  it("reports a body-only change and leaves the frontmatter unchanged", async () => {
    const { client } = spyClient({
      live: file("title: About", "<p>Old prose.</p>"),
      staged: file("title: About", "<p>New prose.</p>"),
    });
    const diff = await loadEntryDiff(client, PATH);
    expect(diff.status).toBe("changed");
    expect(changedPaths(diff)).toEqual([BODY_FIELD]);
    expect(at(diff.fields, BODY_FIELD)).toMatchObject({
      live: "<p>Old prose.</p>",
      staged: "<p>New prose.</p>",
    });
  });

  it("does not report surrounding blank lines as a body change", async () => {
    // A bot-written draft (raw markdown) and a Lanza-written file differ in the
    // whitespace around the body alone. Nobody reviews that.
    const { client } = spyClient({
      live: "---\ntitle: About\n---\nHello.",
      staged: "---\ntitle: About\n---\n\nHello.\n\n",
    });
    expect((await loadEntryDiff(client, PATH)).status).toBe("unchanged");
  });

  // js-yaml loads a YAML timestamp as a Date, and a Date has no own keys — walked
  // as an object, any two dates compare equal and every date change disappears.
  it("compares datetime frontmatter by its value", async () => {
    const same = spyClient({
      live: file("publishDate: 2026-08-15"),
      staged: file("publishDate: 2026-08-15"),
    });
    expect((await loadEntryDiff(same.client, PATH)).status).toBe("unchanged");

    const moved = spyClient({
      live: file("publishDate: 2026-08-15"),
      staged: file("publishDate: 2026-08-16"),
    });
    const diff = await loadEntryDiff(moved.client, PATH);
    expect(changedPaths(diff)).toEqual(["publishDate"]);
  });

  it("calls a page that was never published NEW, not wholly changed", async () => {
    const { client } = spyClient({ staged: file("title: Brand new", "<p>Draft.</p>") });
    const diff = await loadEntryDiff(client, PATH);
    expect(diff.status).toBe("new");
    // Every field is ADDED — nothing claims a live value that never existed.
    expect(diff.fields.map((f) => f.status)).toEqual(["added", "added"]);
    expect(at(diff.fields, "title")).toMatchObject({ live: undefined, staged: "Brand new" });
    expect(at(diff.fields, BODY_FIELD)?.staged).toBe("<p>Draft.</p>");
  });

  it("calls a page dropped on staging DELETED and keeps what would go away", async () => {
    const { client } = spyClient({ live: file("title: Retired", "<p>Bye.</p>") });
    const diff = await loadEntryDiff(client, PATH);
    expect(diff.status).toBe("deleted");
    expect(diff.fields.map((f) => f.status)).toEqual(["removed", "removed"]);
    expect(at(diff.fields, "title")).toMatchObject({ live: "Retired", staged: undefined });
  });

  it("calls a path on neither branch absent rather than failing", async () => {
    const { client } = spyClient({});
    expect(await loadEntryDiff(client, PATH)).toEqual({ path: PATH, status: "absent", fields: [] });
  });

  it("still throws when GitHub fails for any reason other than 404", async () => {
    // A 500 read as "not published" would show a live page as brand new and invite
    // a reviewer to approve a diff that was never loaded.
    const { client } = spyClient({ live: 500, staged: file("title: About") });
    await expect(loadEntryDiff(client, PATH)).rejects.toThrow(GitHubError);

    const { client: staging } = spyClient({ live: file("title: About"), staged: 403 });
    await expect(loadEntryDiff(staging, PATH)).rejects.toThrow(GitHubError);
  });
});

// What the review UI hands the preview to highlight, so a path that shouldn't be
// in the list lights up a region nobody edited.
describe("changedPaths", () => {
  it("returns only the differing paths, in report order", async () => {
    const { client } = spyClient({
      live: file("title: About\nsubtitle: Old\nsame: keep", "<p>Old.</p>"),
      staged: file("title: About us\nsame: keep\nhero: /x.jpg", "<p>New.</p>"),
    });
    const diff = await loadEntryDiff(client, PATH);
    // Report order: live keys first (title, subtitle), then staging-only (hero),
    // then the body — and `same` never appears.
    expect(changedPaths(diff)).toEqual(["title", "subtitle", "hero", BODY_FIELD]);
  });

  it("returns nothing for an entry that is identical on both branches", async () => {
    const raw = file("title: About\nseo:\n  description: d");
    const { client } = spyClient({ live: raw, staged: raw });
    const diff = await loadEntryDiff(client, PATH);
    expect(diff.status).toBe("unchanged");
    expect(changedPaths(diff)).toEqual([]);
    // Not because the field list is empty — every field is there, just unchanged.
    expect(diff.fields.length).toBe(3);
  });

  it("returns every path for a page that has never been published", async () => {
    const { client } = spyClient({
      staged: file("title: New\nslots:\n  cards:\n    - heading: One"),
    });
    const diff = await loadEntryDiff(client, PATH);
    expect(diff.status).toBe("new");
    expect(changedPaths(diff)).toEqual(diff.fields.map((f) => f.path));
    // `slots` is reported ONCE, at the root of the subtree, carrying the whole
    // value — an absent side has nothing to walk against, so there are no leaf
    // paths to name. For a page that never existed the whole region is new
    // anyway, which is exactly what the preview would highlight.
    expect(changedPaths(diff)).toEqual(["title", "slots", BODY_FIELD]);
    expect(at(diff.fields, "slots")?.staged).toEqual({ cards: [{ heading: "One" }] });
  });

  it("returns every path for a page staging deleted", async () => {
    const { client } = spyClient({ live: file("title: Retired") });
    const diff = await loadEntryDiff(client, PATH);
    expect(changedPaths(diff)).toEqual(["title", BODY_FIELD]);
  });

  it("returns nothing for a path on neither branch", async () => {
    const { client } = spyClient({});
    expect(changedPaths(await loadEntryDiff(client, PATH))).toEqual([]);
  });
});

// Putting ONE field back. Pure: the caller owns a Vue reactive `data` and applies
// what this returns, so anything mutated in place here edits the page underneath
// the reviewer.
describe("revertValue", () => {
  const row = (over: Partial<FieldDiff>): FieldDiff => ({
    path: "title",
    status: "changed",
    live: "About",
    staged: "About us",
    ...over,
  });

  it("restores a leaf to the live value", () => {
    const data = { title: "About us", draft: true };
    const { data: next } = revertValue(data, "b", row({}));
    expect(next).toEqual({ title: "About", draft: true });
  });

  it("restores a nested leaf and leaves its siblings alone", () => {
    const data = { seo: { title: "T", description: "new" }, other: 1 };
    const { data: next } = revertValue(
      data,
      "b",
      row({ path: "seo.description", live: "old", staged: "new" }),
    );
    expect(next).toEqual({ seo: { title: "T", description: "old" }, other: 1 });
  });

  it("never mutates the input, at any depth", () => {
    const data = { seo: { description: "new" }, list: [{ heading: "new" }] };
    const before = JSON.stringify(data);
    revertValue(data, "b", row({ path: "seo.description", live: "old", staged: "new" }));
    revertValue(data, "b", row({ path: "list.0.heading", live: "old", staged: "new" }));
    expect(JSON.stringify(data)).toBe(before);
  });

  it("restores an array item at its index", () => {
    const data = { slots: { cards: [{ heading: "Uno" }, { heading: "Two" }] } };
    const { data: next } = revertValue(
      data,
      "b",
      row({ path: "slots.cards.0.heading", live: "One", staged: "Uno" }),
    );
    expect(next).toEqual({ slots: { cards: [{ heading: "One" }, { heading: "Two" }] } });
  });

  // The case the reviewer hits most on a template page: object → array → object.
  it("restores a leaf nested in an array inside an object", () => {
    const data = {
      slots: { sections: [{ cards: [{ title: "a" }] }, { cards: [{ title: "wrong" }] }] },
    };
    const { data: next } = revertValue(
      data,
      "b",
      row({ path: "slots.sections.1.cards.0.title", live: "right", staged: "wrong" }),
    );
    expect(next).toEqual({
      slots: { sections: [{ cards: [{ title: "a" }] }, { cards: [{ title: "right" }] }] },
    });
  });

  it("restores a whole container from an added/removed row", () => {
    // An added/removed subtree is reported at its ROOT carrying the whole value,
    // so reverting it puts the entire subtree back in one go.
    const data = { slots: { cards: [{ heading: "new" }] } };
    const live = { cards: [{ heading: "old" }, { heading: "also old" }] };
    const { data: next } = revertValue(data, "b", row({ path: "slots", live, staged: data.slots }));
    expect(next).toEqual({ slots: live });
  });

  describe("a field that isn't on the live site", () => {
    it("removes the key an `added` row describes", () => {
      const data = { title: "T", hero: "/x.jpg" };
      const { data: next } = revertValue(
        data,
        "b",
        row({ path: "hero", status: "added", live: undefined, staged: "/x.jpg" }),
      );
      expect(next).toEqual({ title: "T" });
      expect("hero" in next).toBe(false); // gone, not set to undefined
    });

    // An `added` array index is ALWAYS a trailing one — the differ only reports it
    // when i >= live.length — so splicing shifts no live item. A hole would be
    // worse: it serializes as a `null` item and renders an empty card.
    it("splices an added array item out instead of leaving a hole", () => {
      const data = { cards: ["a", "b", "c"] };
      const { data: next } = revertValue(
        data,
        "b",
        row({ path: "cards.2", status: "added", live: undefined, staged: "c" }),
      );
      expect(next).toEqual({ cards: ["a", "b"] });
    });

    it("puts a `removed` key back", () => {
      const data = { title: "T" };
      const { data: next } = revertValue(
        data,
        "b",
        row({ path: "subtitle", status: "removed", live: "Was here", staged: undefined }),
      );
      expect(next).toEqual({ title: "T", subtitle: "Was here" });
    });

    it("restores several removed array items to the live list, in either order", () => {
      // Clamping the insert to the array's end is what makes this converge: the
      // live list is [a,b,c] and staging kept only [a].
      const b = row({ path: "cards.1", status: "removed", live: "b", staged: undefined });
      const c = row({ path: "cards.2", status: "removed", live: "c", staged: undefined });

      const forward = revertValue(revertValue({ cards: ["a"] }, "x", b).data, "x", c).data;
      expect(forward).toEqual({ cards: ["a", "b", "c"] });

      // Clicked bottom-up, an index-3-into-a-1-item-array assignment would have
      // left holes; the clamp lands it at the end and the next revert slots in.
      const backward = revertValue(revertValue({ cards: ["a"] }, "x", c).data, "x", b).data;
      expect(backward).toEqual({ cards: ["a", "b", "c"] });
    });
  });

  it("returns the live body and does not touch the data", () => {
    const data = { title: "T" };
    const result = revertValue(data, "<p>New.</p>", {
      path: BODY_FIELD,
      status: "changed",
      live: "<p>Old.</p>",
      staged: "<p>New.</p>",
    });
    expect(result.body).toBe("<p>Old.</p>");
    expect(result.data).toBe(data); // same object — nothing about the fields moved
  });

  describe("a path that has moved on since the diff was taken", () => {
    // Another revert, or another edit, can remove the container a row points into.
    // Rebuilding it would write a field the reviewer never asked for.
    it("returns the input unchanged rather than inventing the containers", () => {
      const data = { title: "T" };
      const result = revertValue(
        data,
        "b",
        row({ path: "seo.description", live: "old", staged: "new" }),
      );
      expect(result.data).toBe(data);
      expect("seo" in result.data).toBe(false);
    });

    it("returns the input unchanged for an array index that is gone", () => {
      const data = { cards: ["a"] };
      const result = revertValue(
        data,
        "b",
        row({ path: "cards.4.heading", live: "old", staged: "new" }),
      );
      expect(result.data).toBe(data);
    });

    it("returns the input unchanged when an added key is already gone", () => {
      const data = { title: "T" };
      const result = revertValue(
        data,
        "b",
        row({ path: "hero", status: "added", live: undefined, staged: "/x.jpg" }),
      );
      expect(result.data).toBe(data);
    });

    it("does nothing at all for an unchanged row", () => {
      const data = { title: "T" };
      const result = revertValue(data, "body", row({ status: "unchanged", live: "T", staged: "T" }));
      expect(result.data).toBe(data);
      expect(result.body).toBe("body");
    });
  });

  // The diff is the reviewer's record of what production says. If the restored
  // value were the SAME object, the next edit in the form would rewrite that record
  // and they'd be reading their own edit back as the live site.
  it("shares no reference with the live value it restored", () => {
    const live = { cards: [{ heading: "One" }] };
    const data = { slots: { cards: [{ heading: "Uno" }] } };
    const { data: next } = revertValue(data, "b", row({ path: "slots", live, staged: data.slots }));

    const restored = next.slots as { cards: { heading: string }[] };
    expect(restored).not.toBe(live);
    expect(restored.cards).not.toBe(live.cards);
    expect(restored.cards[0]).not.toBe(live.cards[0]);

    restored.cards[0].heading = "edited afterwards";
    expect(live.cards[0].heading).toBe("One");
  });

  it("clones a restored Date rather than aliasing it", () => {
    const live = new Date("2026-08-15T00:00:00Z");
    const data = { publishDate: new Date("2026-08-16T00:00:00Z") };
    const { data: next } = revertValue(
      data,
      "b",
      row({ path: "publishDate", live, staged: data.publishDate }),
    );
    const restored = next.publishDate as Date;
    expect(restored).not.toBe(live);
    expect(restored.getTime()).toBe(live.getTime());
  });

  // The signature exists to work on the editor's reactive object, which
  // structuredClone refuses outright (a Proxy has no structured-clone behaviour).
  it("works on a Vue reactive object", () => {
    const data = reactive({ seo: { description: "new" } }) as Record<string, unknown>;
    const { data: next } = revertValue(
      data,
      "b",
      row({ path: "seo.description", live: "old", staged: "new" }),
    );
    expect(next).toEqual({ seo: { description: "old" } });
    expect(isReactive(next)).toBe(false); // a plain object for the caller to apply
  });
});
