import { describe, it, expect } from "vitest";
import {
  compareVersions,
  updateAvailable,
  securityUpdateRequired,
  type VersionState,
} from "./version";

// A tenant on `live`, with the registry offering `latest` and flooring at `critical`.
function state(
  live: string | null,
  latest: string,
  critical: string | null = null,
  staged: string | null = null,
): VersionState {
  return {
    live,
    staged,
    registry: { latest, critical, releases: [] },
    unmanaged: live === null && staged === null,
    offline: false,
  };
}

describe("compareVersions", () => {
  it("orders by numeric segment, not string", () => {
    // The bug a string sort would hide: "0.1.10" < "0.1.9" lexically.
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.1.2", "0.1.2")).toBe(0);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.1")).toBe(-1);
  });

  it("sorts a prerelease before its release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
  });
});

describe("updateAvailable", () => {
  it("is true only when the registry is genuinely ahead", () => {
    expect(updateAvailable(state("0.1.1", "0.1.2"))).toBe(true);
    expect(updateAvailable(state("0.1.2", "0.1.2"))).toBe(false);
  });

  it("is false when the tenant is AHEAD of latest", () => {
    // Happens right after we publish then unpublish, or on a prerelease pin.
    expect(updateAvailable(state("0.2.0", "0.1.2"))).toBe(false);
  });

  it("compares against the staged pin, not the live one", () => {
    // Already chose 0.1.2 but hasn't published: don't keep offering 0.1.2.
    expect(updateAvailable(state("0.1.1", "0.1.2", null, "0.1.2"))).toBe(false);
  });

  it("offers nothing when the registry is unreachable", () => {
    const s = { ...state("0.1.1", "0.1.2"), registry: null, offline: true };
    expect(updateAvailable(s)).toBe(false);
  });

  it("offers nothing for a repo with no dependency to bump", () => {
    expect(updateAvailable(state(null, "0.1.2"))).toBe(false);
  });
});

describe("securityUpdateRequired", () => {
  it("fires only below the critical floor", () => {
    expect(securityUpdateRequired(state("0.1.1", "0.2.0", "0.1.2"))).toBe(true);
    expect(securityUpdateRequired(state("0.1.2", "0.2.0", "0.1.2"))).toBe(false);
    expect(securityUpdateRequired(state("0.1.3", "0.2.0", "0.1.2"))).toBe(false);
  });

  it("stays quiet when no floor is published", () => {
    // No `critical` dist-tag must never be read as "everything is critical".
    expect(securityUpdateRequired(state("0.0.1", "9.9.9", null))).toBe(false);
  });

  it("stays quiet when the version is unknown", () => {
    expect(securityUpdateRequired(state(null, "0.2.0", "0.1.2"))).toBe(false);
  });
});
