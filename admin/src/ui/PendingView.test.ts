import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import PendingView from "./PendingView.vue";
import { setCollections, type Collection } from "../schema";
import { site } from "../backend/site";
import type { GitHubClient } from "./../backend/github";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div/>" } }],
});

// The content model this screen classifies against. Set explicitly so the test
// doesn't move the day someone edits the repo's own data/schema.json.
const MODEL: Collection[] = [
  {
    kind: "folder",
    name: "pages",
    label: "Pages",
    labelSingular: "Page",
    folder: "content/pages",
    body: "rich",
    localized: true,
    fields: [],
  },
  {
    kind: "files",
    name: "settings",
    label: "Settings",
    files: [
      { name: "menu", label: "Menu", file: "data/menu.json", localized: true, fields: [] },
      { name: "redirects", label: "Redirects", file: "data/redirects.json", fields: [] },
    ],
  },
];

beforeEach(() => {
  setCollections(MODEL);
  site.defaultLocale = "en";
  site.locales = [{ code: "en", label: "English" }, { code: "es", label: "Español" }];
});

/** A client whose compare() returns the given diff-entries — the only call made. */
function clientWith(files?: { filename: string; status: string; previous_filename?: string }[]) {
  return { compare: async () => ({ status: "ahead", files }) } as unknown as GitHubClient;
}

async function mountView(files?: Parameters<typeof clientWith>[0]) {
  const w = mount(PendingView, {
    props: { client: clientWith(files) },
    global: { plugins: [router] },
  });
  await flushPromises();
  return w;
}

const hrefs = (w: Awaited<ReturnType<typeof mountView>>) =>
  w.findAll("a").map((a) => a.attributes("href"));

describe("PendingView — the healthy state", () => {
  it("reads as good news, not as an empty table or an error", async () => {
    const w = await mountView([]);
    expect(w.text()).toContain("Nothing waiting");
    expect(w.text()).toContain("Your site matches what's published");
    expect(w.findAll("li")).toHaveLength(0);
  });

  it("says the same when GitHub omits the file list entirely", async () => {
    const w = await mountView(undefined);
    expect(w.text()).toContain("Nothing waiting");
  });

  it("offers no publish control when there is nothing to publish", async () => {
    const w = await mountView([]);
    expect(w.text()).not.toContain("Publish everything");
  });
});

describe("PendingView — publishing is all or nothing", () => {
  it("labels the only publish control as publishing everything", async () => {
    const w = await mountView([{ filename: "content/pages/en/about.md", status: "modified" }]);
    // A per-row "Publish" would be a lie: publishing is a staging→main merge, so
    // it always sends every row. There must be exactly one, and it must say so.
    expect(w.text()).toContain("Publish everything");
    expect(hrefs(w)).toContain("/publish");
    expect(w.findAll('[href="/publish"]')).toHaveLength(1);
  });

  it("warns that publishing sends all of it", async () => {
    const w = await mountView([{ filename: "content/pages/en/about.md", status: "modified" }]);
    expect(w.text()).toContain("all of it");
  });
});

describe("PendingView — each kind renders as itself", () => {
  const everything = [
    { filename: "content/pages/en/about.md", status: "modified" },
    { filename: "data/menu.json", status: "modified" },
    { filename: "templates/manifesto/template.html", status: "modified" },
    { filename: "public/images/uploads/hero.jpg", status: "added" },
    { filename: "astro.config.mjs", status: "modified" },
  ];

  it("groups them and never files a settings change under content", async () => {
    const w = await mountView(everything);
    const text = w.text();
    for (const label of ["Settings", "Templates", "Content", "Media", "Other files"]) {
      expect(text, label).toContain(label);
    }
    expect(w.findAll("li")).toHaveLength(5);
  });

  it("orders the groups by blast radius, widest first", async () => {
    const w = await mountView(everything);
    const headings = w.findAll("h2").map((h) => h.text());
    // A settings change reshapes the whole site; a typo changes one page. The
    // reviewer's attention should go in that order.
    expect(headings).toEqual(["Settings", "Templates", "Content", "Media", "Other files"]);
  });

  it("names an entry by its slug and its collection, not its repo path", async () => {
    const w = await mountView([{ filename: "content/pages/es/hola.md", status: "added" }]);
    const row = w.find("li").text();
    expect(row).toContain("hola");
    expect(row).toContain("Pages");
    expect(row).toContain("es");
    expect(row).toContain("new"); // GitHub's "added" in the owner's words
  });

  it("names a template by the template it belongs to", async () => {
    const w = await mountView([{ filename: "templates/manifesto/fields.json", status: "modified" }]);
    expect(w.find("li").text()).toContain("manifesto");
  });
});

describe("PendingView — rows link to the thing itself", () => {
  it("links an entry to its editor at the right collection, locale and slug", async () => {
    const w = await mountView([{ filename: "content/pages/es/hola.md", status: "modified" }]);
    expect(hrefs(w)).toContain("/pages/es/hola");
  });

  it("links a settings file to the screen that owns it", async () => {
    // The menu's own editor was folded into Header & footer, exactly as the
    // Sidebar routes it — /settings/menu would render a pane nothing handles.
    const w = await mountView([{ filename: "data/menu.es.json", status: "modified" }]);
    expect(hrefs(w)).toContain("/settings/header-footer");
  });

  it("links a settings file that kept its own screen by its declared name", async () => {
    const w = await mountView([{ filename: "data/redirects.json", status: "modified" }]);
    expect(hrefs(w)).toContain("/settings/redirects");
  });

  // App.vue opens entryFolder(collection, locale)/<slug>.md. The home page lives at
  // a localized collection's ROOT, so that reconstruction points somewhere else —
  // linking anyway would open a blank new entry and invite someone to save it.
  it("does not link a row whose URL would open a different file", async () => {
    const w = await mountView([{ filename: "content/pages/home.md", status: "modified" }]);
    expect(w.find("li").text()).toContain("home"); // still listed
    expect(hrefs(w)).not.toContain("/pages/en/home");
  });

  it("lists a file no screen owns without pretending it is a link", async () => {
    const w = await mountView([{ filename: "astro.config.mjs", status: "modified" }]);
    const row = w.find("li");
    expect(row.text()).toContain("astro.config.mjs");
    expect(row.find("a").exists()).toBe(false);
  });
});

describe("PendingView — a rename that moves a public address", () => {
  const renamed = [
    {
      filename: "content/pages/en/about-us.md",
      status: "renamed",
      previous_filename: "content/pages/en/about.md",
    },
  ];

  it("marks it, because publishing it breaks every existing link", async () => {
    const w = await mountView(renamed);
    const row = w.find("li").text();
    expect(row).toContain("Address changed");
    expect(row).toContain("content/pages/en/about.md"); // what it was
  });

  it("offers the redirects screen, which is the fix", async () => {
    const w = await mountView(renamed);
    expect(hrefs(w)).toContain("/settings/redirects");
  });

  it("does not mark a rename nobody has bookmarked", async () => {
    const w = await mountView([
      {
        filename: "templates/new/template.html",
        status: "renamed",
        previous_filename: "templates/old/template.html",
      },
    ]);
    expect(w.text()).not.toContain("Address changed");
  });

  it("does not mark an ordinary edit", async () => {
    const w = await mountView([{ filename: "content/pages/en/about.md", status: "modified" }]);
    expect(w.text()).not.toContain("Address changed");
  });
});

describe("PendingView — reading order", () => {
  it("keeps a page and its translations next to each other", async () => {
    // Sorted by path, the locale folder splits them apart; a reviewer wants the
    // same page's languages together.
    const w = await mountView([
      { filename: "content/pages/es/zebra.md", status: "modified" },
      { filename: "content/pages/en/apple.md", status: "modified" },
      { filename: "content/pages/es/apple.md", status: "modified" },
    ]);
    const rows = w.findAll("li").map((li) => li.text());
    expect(rows[0]).toContain("apple");
    expect(rows[1]).toContain("apple");
    expect(rows[2]).toContain("zebra");
    expect(rows[0]).toContain("en");
    expect(rows[1]).toContain("es");
  });
});

describe("PendingView — discarding the whole draft", () => {
  /** A client that counts compare() calls (so a reload is observable) and records
   *  whether the destructive write actually happened. */
  function discardClient(files: { filename: string; status: string }[]) {
    const calls = { compare: 0, discard: 0 };
    const client = {
      compare: async () => {
        calls.compare++;
        // After the discard the branch matches production: nothing pending.
        return { status: "ahead", files: calls.discard ? [] : files };
      },
      discardDraft: async () => {
        calls.discard++;
        return { sha: "abc123" };
      },
    } as unknown as GitHubClient;
    return { client, calls };
  }

  async function mountDiscardable(files: { filename: string; status: string }[]) {
    const { client, calls } = discardClient(files);
    const w = mount(PendingView, { props: { client }, global: { plugins: [router] } });
    await flushPromises();
    const button = w.findAll("button").find((b) => b.text().includes("Discard everything"));
    return { w, calls, button };
  }

  const ONE = [{ filename: "content/pages/en/about.md", status: "modified" }];

  it("is not offered when there is nothing to discard", async () => {
    const { button } = await mountDiscardable([]);
    expect(button).toBeUndefined();
  });

  it("names what will be lost rather than asking 'are you sure?'", async () => {
    let prompt = "";
    window.confirm = (m?: string) => {
      prompt = m ?? "";
      return false;
    };
    const { button, calls } = await mountDiscardable(ONE);
    await button!.trigger("click");
    await flushPromises();
    expect(prompt).toContain("about"); // the row itself, by name
    expect(prompt).toContain("edited"); // and what happened to it
    expect(prompt).toContain("cannot be undone");
    // Declining leaves the draft alone — this is the irreversible one.
    expect(calls.discard).toBe(0);
  });

  it("discards and reloads, so the screen shows the truth from the server", async () => {
    window.confirm = () => true;
    const { w, button, calls } = await mountDiscardable(ONE);
    await button!.trigger("click");
    await flushPromises();
    expect(calls.discard).toBe(1);
    expect(calls.compare).toBe(2); // mounted, then again after the write
    expect(w.text()).toContain("Nothing waiting");
  });
});
