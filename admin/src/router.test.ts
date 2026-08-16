import { describe, it, expect } from "vitest";
import { listRoute, entryRoute } from "./router";

describe("route builders", () => {
  it("build list + entry URLs", () => {
    expect(listRoute("pages", "en")).toBe("/pages/en");
    expect(entryRoute("pages", "en", "home")).toBe("/pages/en/home");
    expect(entryRoute("pages", "en", "new")).toBe("/pages/en/new");
  });

  // The entry locale bar navigates to the same slug under another locale — the
  // language switch that used to live on the sidebar is now just this.
  it("reach an entry's other language by swapping the locale segment", () => {
    expect(entryRoute("pages", "es", "home")).toBe("/pages/es/home");
    expect(entryRoute("posts", "en", "hola")).toBe("/posts/en/hola");
  });
});
