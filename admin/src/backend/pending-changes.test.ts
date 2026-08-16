import { describe, it, expect } from "vitest";
import {
  loadPendingChanges,
  classifyPath,
  movedPublicUrl,
  type PendingChange,
} from "./pending-changes";
import type { GitHubClient } from "./github";
import type { FolderCollection } from "../schema";

function collection(over: Partial<FolderCollection> & { name: string }): FolderCollection {
  return {
    kind: "folder",
    label: over.name,
    labelSingular: over.name,
    folder: `content/${over.name}`,
    body: "rich",
    fields: [],
    ...over,
  };
}

// An explicit model rather than the repo's data/schema.json: these tests are about
// the mapping, and pinning them to the live content model would make them fail the
// day someone renames a collection for unrelated reasons.
const MODEL: FolderCollection[] = [
  collection({ name: "posts", localized: true }),
  collection({ name: "pages", localized: true }),
  collection({ name: "authors" }), // shared across languages
];

/** A GitHubClient whose compare() returns the given diff-entries. */
function spyClient(files?: { filename: string; status: string; previous_filename?: string }[]) {
  const calls: string[] = [];
  const client = {
    compare: async (base: string, head: string) => {
      calls.push(`${base}...${head}`);
      return { status: "ahead", files };
    },
  } as unknown as GitHubClient;
  return { client, calls };
}

const load = (files?: Parameters<typeof spyClient>[0]) =>
  loadPendingChanges(spyClient(files).client, MODEL);

const at = (rows: PendingChange[], path: string) => rows.find((r) => r.path === path);

describe("loadPendingChanges", () => {
  it("asks production…staging, one request for the whole site", async () => {
    const { client, calls } = spyClient([]);
    await loadPendingChanges(client, MODEL);
    // Direction matters: staging is the side holding the unpublished work, so it
    // is the head. Reversed, every added page would report as removed.
    expect(calls).toEqual(["main...staging"]);
  });

  it("reads nothing but the compare — no file contents", async () => {
    // The client has ONLY compare on it; any loadText/loadEntry call would throw.
    // That is the assertion: this list costs one request no matter how big the site.
    const rows = await load([{ filename: "content/posts/en/hello.md", status: "modified" }]);
    expect(rows).toHaveLength(1);
  });

  it("reports nothing pending as an empty list, not a failure", async () => {
    expect(await load([])).toEqual([]);
    // GitHub omits `files` entirely when the refs are identical.
    expect(await load(undefined)).toEqual([]);
  });

  it("maps GitHub's status vocabulary to ours", async () => {
    const rows = await load([
      { filename: "content/posts/en/a.md", status: "added" },
      { filename: "content/posts/en/b.md", status: "modified" },
      { filename: "content/posts/en/c.md", status: "removed" },
      { filename: "content/posts/en/d.md", status: "renamed", previous_filename: "content/posts/en/old.md" },
      { filename: "content/posts/en/e.md", status: "copied", previous_filename: "content/posts/en/a.md" },
      { filename: "content/posts/en/f.md", status: "changed" },
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      "added",
      "modified",
      "removed",
      "renamed",
      "added", // a copy creates a file that wasn't there
      "modified",
    ]);
  });

  it("keeps a status it doesn't recognise as a change rather than dropping the row", async () => {
    const rows = await load([{ filename: "content/posts/en/a.md", status: "unmapped" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("modified");
  });
});

describe("classifyPath — entries", () => {
  it("pulls the collection, slug and locale out of a localized path", () => {
    expect(classifyPath("content/posts/es/hola-mundo.md", MODEL)).toEqual({
      kind: "entry",
      collection: "posts",
      slug: "hola-mundo",
      locale: "es",
    });
  });

  it("reads a translation as the same slug under a different locale", () => {
    const en = classifyPath("content/posts/en/hello.md", MODEL);
    const es = classifyPath("content/posts/es/hello.md", MODEL);
    expect(en).toMatchObject({ slug: "hello", locale: "en" });
    expect(es).toMatchObject({ slug: "hello", locale: "es" });
  });

  it("has no locale for an entry at a localized collection's root", () => {
    // The home page lives at the pages root, not in a locale folder.
    expect(classifyPath("content/pages/home.md", MODEL)).toEqual({
      kind: "entry",
      collection: "pages",
      slug: "home",
      locale: null,
    });
  });

  it("has no locale for a collection shared across languages", () => {
    expect(classifyPath("content/authors/dave.md", MODEL)).toEqual({
      kind: "entry",
      collection: "authors",
      slug: "dave",
      locale: null,
    });
  });

  // A collection whose folder sits inside another's would otherwise be swallowed by
  // its parent, filing every one of its entries under the wrong collection.
  it("files an entry under the most specific collection folder", () => {
    const nested = [
      collection({ name: "content", folder: "content" }),
      collection({ name: "posts", folder: "content/posts", localized: true }),
    ];
    expect(classifyPath("content/posts/en/hello.md", nested)).toMatchObject({
      collection: "posts",
      slug: "hello",
      locale: "en",
    });
  });

  it("does not call a non-markdown file inside a collection folder an entry", () => {
    expect(classifyPath("content/posts/en/diagram.png", MODEL)).toEqual({ kind: "other" });
  });
});

describe("classifyPath — the things that are not pages", () => {
  it("calls a settings file settings", () => {
    // Absolutely belongs in "what needs me today" — a menu or schema change is
    // bigger than a typo fix — but it is not a page and must not be labelled one.
    expect(classifyPath("data/site.json", MODEL)).toEqual({ kind: "settings", file: "data/site.json" });
    expect(classifyPath("data/menu.es.json", MODEL)).toMatchObject({ kind: "settings" });
    expect(classifyPath("data/schema.json", MODEL)).toMatchObject({ kind: "settings" });
  });

  it("names the template a template change belongs to", () => {
    // The directory name IS the page's `preset`, which is what links this row to
    // the pages it would change.
    expect(classifyPath("templates/manifesto/template.html", MODEL)).toEqual({
      kind: "template",
      template: "manifesto",
    });
    expect(classifyPath("templates/manifesto/fields.json", MODEL)).toMatchObject({
      template: "manifesto",
    });
  });

  it("calls anything the site serves statically media", () => {
    expect(classifyPath("public/images/uploads/hero.jpg", MODEL)).toEqual({
      kind: "media",
      file: "public/images/uploads/hero.jpg",
    });
    expect(classifyPath("public/favicon.svg", MODEL)).toMatchObject({ kind: "media" });
  });

  it("admits when it doesn't know what a path is", () => {
    // Config edited on GitHub directly. Still pending, still shown, not claimed to
    // be a page — inventing a collection for it is how the list starts lying.
    for (const path of ["package.json", "astro.config.mjs", "README.md", "src/x.ts"]) {
      expect(classifyPath(path, MODEL), path).toEqual({ kind: "other" });
    }
  });

  it("classifies against the live content model when none is passed", () => {
    // Only the model-independent half is asserted, so this can't break when the
    // repo's own collections are renamed.
    expect(classifyPath("data/site.json")).toMatchObject({ kind: "settings" });
    expect(classifyPath("package.json")).toEqual({ kind: "other" });
  });
});

describe("renames", () => {
  it("carries where the file came from, classified the same way", async () => {
    const rows = await load([
      {
        filename: "content/pages/en/about-us.md",
        status: "renamed",
        previous_filename: "content/pages/en/about.md",
      },
    ]);
    const row = at(rows, "content/pages/en/about-us.md")!;
    expect(row.status).toBe("renamed");
    expect(row.previous).toEqual({
      path: "content/pages/en/about.md",
      target: { kind: "entry", collection: "pages", slug: "about", locale: "en" },
    });
  });

  it("is null when the file did not come from anywhere", async () => {
    const rows = await load([{ filename: "content/pages/en/about.md", status: "modified" }]);
    expect(rows[0].previous).toBe(null);
  });

  it("survives a rename GitHub reports without a previous_filename", async () => {
    // Then the origin is unknown — which is a row with no `previous`, not a crash.
    const rows = await load([{ filename: "content/pages/en/about-us.md", status: "renamed" }]);
    expect(rows[0].status).toBe("renamed");
    expect(rows[0].previous).toBe(null);
  });
});

describe("movedPublicUrl", () => {
  const renameRow = (from: string, to: string): PendingChange => ({
    path: to,
    status: "renamed",
    target: classifyPath(to, MODEL),
    previous: { path: from, target: classifyPath(from, MODEL) },
  });

  it("is true for a slug change — the case that needs a redirect", () => {
    expect(
      movedPublicUrl(renameRow("content/pages/en/about.md", "content/pages/en/about-us.md")),
    ).toBe(true);
  });

  it("is true for an entry moved between locales", () => {
    expect(
      movedPublicUrl(renameRow("content/posts/en/hello.md", "content/posts/es/hello.md")),
    ).toBe(true);
  });

  it("is false for a rename nobody has bookmarked", () => {
    expect(
      movedPublicUrl(renameRow("templates/old/template.html", "templates/new/template.html")),
    ).toBe(false);
    expect(movedPublicUrl(renameRow("public/a.jpg", "public/b.jpg"))).toBe(false);
  });

  it("is false when nothing was renamed at all", async () => {
    const rows = await load([{ filename: "content/pages/en/about.md", status: "modified" }]);
    expect(movedPublicUrl(rows[0])).toBe(false);
  });
});
