import { describe, it, expect } from "vitest";
import type { GitHubClient } from "./github";
import type { FolderCollection } from "../schema";
import {
  findTranslations,
  setTranslationSeed,
  stemOf,
  takeTranslationSeed,
  translationShell,
} from "./translations";

// A translation is "the same filename stem under the other locale's folder" — the
// rule frontend/lib/alternates.ts uses at build time. If the CMS disagreed with it,
// the editor would offer to create a translation the site would never link to.

const pages: FolderCollection = {
  kind: "folder",
  name: "pages",
  label: "Pages",
  labelSingular: "Page",
  folder: "content/pages",
  body: "rich",
  localized: true,
  fields: [],
};
const authors: FolderCollection = { ...pages, name: "authors", folder: "content/authors" };
delete authors.localized;

// Minimal stand-in for the GitHub client: a repo as dir → filenames, plus a log of
// which directories were actually asked for.
function fakeClient(tree: Record<string, string[]>) {
  const asked: string[] = [];
  const client = {
    listDir: async (dir: string) => {
      asked.push(dir);
      return (tree[dir] ?? []).map((name) => ({ name, path: `${dir}/${name}`, sha: "x" }));
    },
  };
  return { client: client as unknown as GitHubClient, asked };
}

describe("stemOf", () => {
  it("is the filename without .md, and empty for a new entry", () => {
    expect(stemOf("content/pages/es/inicio.md")).toBe("inicio");
    expect(stemOf("content/authors/dave.md")).toBe("dave");
    expect(stemOf(null)).toBe("");
  });
});

describe("findTranslations", () => {
  it("reports the locales whose folder holds the stem", async () => {
    const { client } = fakeClient({
      "content/pages/en": ["home.md", "about.md"],
      "content/pages/es": ["home.md"],
    });
    expect(await findTranslations(client, pages, "home", ["en", "es"])).toEqual(
      new Set(["en", "es"]),
    );
    expect(await findTranslations(client, pages, "about", ["en", "es"])).toEqual(new Set(["en"]));
  });

  it("treats a missing locale folder as empty, not an error", async () => {
    // GitHub has no empty directories, so an untranslated locale 404s (listDir → []).
    const { client } = fakeClient({ "content/pages/en": ["about.md"] });
    expect(await findTranslations(client, pages, "about", ["en", "es", "fr"])).toEqual(
      new Set(["en"]),
    );
  });

  it("matches the whole filename, not a prefix of it", async () => {
    const { client } = fakeClient({ "content/pages/es": ["about-us.md"] });
    expect(await findTranslations(client, pages, "about", ["es"])).toEqual(new Set());
  });

  it("a new entry (no stem) exists nowhere, and costs no requests", async () => {
    const { client, asked } = fakeClient({ "content/pages/en": ["home.md"] });
    expect(await findTranslations(client, pages, "", ["en", "es"])).toEqual(new Set());
    expect(asked).toEqual([]);
  });

  it("a shared collection exists in every locale, from one lookup", async () => {
    const { client, asked } = fakeClient({ "content/authors": ["dave.md"] });
    expect(await findTranslations(client, authors, "dave", ["en", "es"])).toEqual(
      new Set(["en", "es"]),
    );
    expect(asked).toEqual(["content/authors"]);
  });
});

describe("translationShell — structure travels, prose never does", () => {
  const source = {
    title: "Our story",
    description: "How we started",
    seo: { metaTitle: "Our story" },
    categories: ["news"],
    preset: "about",
    template: "full-width",
    slots: {
      heading: "Our story",
      cards: [
        { label: "Founded", body: "In 1998" },
        { label: "Team", body: "Twelve people" },
      ],
      columns: 3,
      featured: true,
    },
  };

  it("carries the template and the slot KEYS", () => {
    const shell = translationShell(source);
    expect(shell.preset).toBe("about");
    expect(shell.template).toBe("full-width");
    expect(Object.keys(shell.slots as object)).toEqual(["heading", "cards", "columns", "featured"]);
  });

  it("blanks every string and keeps list length — three cards stay three empty cards", () => {
    const slots = translationShell(source).slots as Record<string, unknown>;
    expect(slots.heading).toBe("");
    expect(slots.cards).toEqual([
      { label: "", body: "" },
      { label: "", body: "" },
    ]);
    expect(slots.columns).toBe(3); // a setting, not copy
    expect(slots.featured).toBe(true);
  });

  it("drops the title, the SEO text and the relations", () => {
    const shell = translationShell(source);
    for (const gone of ["title", "description", "seo", "categories"]) {
      expect(shell, gone).not.toHaveProperty(gone);
    }
  });

  it("no English string survives anywhere in the shell", () => {
    expect(JSON.stringify(translationShell(source))).not.toMatch(/story|1998|Twelve|news/i);
  });

  it("is always a draft — an entry with no words must not publish itself", () => {
    expect(translationShell({ ...source, draft: false }).draft).toBe(true);
  });

  it("leaves the source untouched", () => {
    translationShell(source);
    expect(source.slots.heading).toBe("Our story");
  });

  it("survives an entry with no template at all", () => {
    expect(translationShell({ title: "x" })).toEqual({ draft: true });
  });
});

describe("the seed handoff", () => {
  it("is delivered to exactly the editor it was meant for, once", () => {
    setTranslationSeed({ collection: "pages", locale: "es", slug: "about", data: { preset: "x" } });
    expect(takeTranslationSeed("pages", "en", "about")).toBeNull(); // wrong locale
    expect(takeTranslationSeed("posts", "es", "about")).toBeNull(); // wrong collection
    expect(takeTranslationSeed("pages", "es", "other")).toBeNull(); // wrong entry
    expect(takeTranslationSeed("pages", "es", "about")).toEqual({ preset: "x" });
    expect(takeTranslationSeed("pages", "es", "about")).toBeNull(); // already taken
  });
});
