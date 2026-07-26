import { describe, it, expect } from "vitest";
import { productionOriginIfPreview } from "./previewOrigin";

describe("productionOriginIfPreview", () => {
  it("names the production origin from a branch alias", () => {
    expect(productionOriginIfPreview("staging.mcp-test-736f7e918662.pages.dev")).toBe(
      "https://mcp-test-736f7e918662.pages.dev",
    );
  });

  it("names it from a per-deployment hash URL too", () => {
    expect(productionOriginIfPreview("4eb5de2d.mcp-test-736f7e918662.pages.dev")).toBe(
      "https://mcp-test-736f7e918662.pages.dev",
    );
  });

  // The production host must NOT be mistaken for a preview, or a real auth failure
  // on the live site would be misreported as "you're on the wrong URL" and the
  // actual cause would go unlooked-at.
  it("returns null on the production host", () => {
    expect(productionOriginIfPreview("mcp-test-736f7e918662.pages.dev")).toBeNull();
  });

  // A custom domain can't be told apart from an apex, and guessing wrong would
  // accuse a healthy site.
  it("returns null on custom domains", () => {
    expect(productionOriginIfPreview("example.com")).toBeNull();
    expect(productionOriginIfPreview("www.example.com")).toBeNull();
    expect(productionOriginIfPreview("staging.example.com")).toBeNull();
  });

  it("is not fooled by a host merely ending in the string", () => {
    expect(productionOriginIfPreview("evil-pages.dev")).toBeNull();
    expect(productionOriginIfPreview("a.notpages.dev")).toBeNull();
  });

  it("handles empty input", () => {
    expect(productionOriginIfPreview("")).toBeNull();
  });
});
