import { describe, it, expect, beforeEach } from "vitest";
import { entryPath, entryPathFrame } from "./site-urls";
import { site } from "./site";

// The locale prefix rule has exactly one home in the admin (site-urls.ts). These
// cases pin it to what the BUILD emits — frontend/pages/[locale]/** with Astro's
// `prefixDefaultLocale: false` — because the editor's URL line is a promise about
// where the entry will actually be.

beforeEach(() => {
  site.defaultLocale = "en";
  site.locales = [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
  ];
});

describe("entryPath", () => {
  it("leaves the default locale at the root and prefixes every other", () => {
    expect(entryPath("pages", "about", "en")).toBe("/about/");
    expect(entryPath("pages", "about", "es")).toBe("/es/about/");
    expect(entryPath("posts", "hello", "en")).toBe("/posts/hello/");
    expect(entryPath("posts", "hello", "es")).toBe("/es/posts/hello/");
    expect(entryPath("categories", "news", "es")).toBe("/es/category/news/");
  });

  it("puts 'home' at the locale root — /home is not a page the build emits", () => {
    expect(entryPath("pages", "home", "en")).toBe("/");
    expect(entryPath("pages", "home", "es")).toBe("/es/");
  });

  // Anchored to a real `astro build` of this repo, whose only content is
  // content/pages/{en,es}/{home,legal}.md. It emitted dist/index.html,
  // dist/es/index.html, dist/legal/index.html and dist/es/legal/index.html — and no
  // dist/home/ at all — while frontend/lib/alternates.ts wrote hreflang="es"
  // href=".../es/legal/". The admin has to say the same thing the build does.
  it("says what the build actually emits", () => {
    expect(entryPath("pages", "home", "en")).toBe("/"); // dist/index.html
    expect(entryPath("pages", "home", "es")).toBe("/es/"); // dist/es/index.html
    expect(entryPath("pages", "legal", "en")).toBe("/legal/"); // dist/legal/
    expect(entryPath("pages", "legal", "es")).toBe("/es/legal/"); // dist/es/legal/
  });

  it("follows the default locale rather than assuming English", () => {
    site.defaultLocale = "es";
    expect(entryPath("pages", "inicio", "es")).toBe("/inicio/");
    expect(entryPath("pages", "about", "en")).toBe("/en/about/");
  });

  it("is null for a collection with no public route — no guessed URL that 404s", () => {
    expect(entryPath("recipes", "risotto", "en")).toBeNull();
    expect(entryPathFrame("recipes", "risotto", "en")).toBeNull();
  });
});

describe("entryPathFrame — the path either side of an editable slug", () => {
  it("rejoins into the full path", () => {
    const frame = entryPathFrame("posts", "hello", "es")!;
    expect(`${frame.prefix}hello${frame.suffix}`).toBe(entryPath("posts", "hello", "es"));
  });

  it("frames the locale root with no trailing segment", () => {
    expect(entryPathFrame("pages", "home", "es")).toEqual({ prefix: "/es/", suffix: "" });
  });
});
