import { describe, it, expect } from "vitest";
import type { RouteLocationNormalized } from "vue-router";
import { listRoute, entryRoute, localeSwapRoute } from "./router";

// Minimal route stand-in for the pure locale-swap logic.
function route(
  name: string,
  params: Record<string, string>,
  fullPath = "",
): RouteLocationNormalized {
  return { name, params, fullPath } as unknown as RouteLocationNormalized;
}

describe("route builders", () => {
  it("build list + entry URLs", () => {
    expect(listRoute("pages", "en")).toBe("/pages/en");
    expect(entryRoute("pages", "en", "home")).toBe("/pages/en/home");
    expect(entryRoute("pages", "en", "new")).toBe("/pages/en/new");
  });
});

describe("localeSwapRoute — language switch goes to the equivalent page", () => {
  it("keeps the open entry, swaps only the locale segment", () => {
    const r = route("entry", { collection: "pages", locale: "en", slug: "home" }, "/pages/en/home");
    expect(localeSwapRoute(r, "es")).toBe("/pages/es/home");
    // and back the other way
    const es = route("entry", { collection: "posts", locale: "es", slug: "hola" }, "/posts/es/hola");
    expect(localeSwapRoute(es, "en")).toBe("/posts/en/hola");
  });

  it("swaps the locale on a collection list", () => {
    const r = route("list", { collection: "pages", locale: "en" }, "/pages/en");
    expect(localeSwapRoute(r, "es")).toBe("/pages/es");
  });

  it("stays put on locale-independent screens (settings/publish/help)", () => {
    const r = route("settings", { panel: "parts" }, "/settings/parts");
    expect(localeSwapRoute(r, "es")).toBe("/settings/parts");
  });
});
