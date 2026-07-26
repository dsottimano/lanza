import { describe, it, expect } from "vitest";
import {
  compareVersions,
  updateAvailable,
  securityUpdateRequired,
  strandsOwner,
  isUnsafeVersion,
  parseForcedUpdate,
  SELF_UPDATE_SINCE,
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

describe("isUnsafeVersion", () => {
  it("blocks anything below the floor and allows the rest", () => {
    const s = state("0.1.2", "0.1.4", "0.1.2");
    expect(isUnsafeVersion("0.1.1", s)).toBe(true);
    expect(isUnsafeVersion("0.1.2", s)).toBe(false);
    expect(isUnsafeVersion("0.1.4", s)).toBe(false);
  });

  it("blocks nothing when no floor is published", () => {
    expect(isUnsafeVersion("0.0.1", state("0.1.2", "0.1.4", null))).toBe(false);
  });
});

describe("parseForcedUpdate", () => {
  it("recognises the broker's forced-update commit", () => {
    expect(parseForcedUpdate("security: move lanza-site to 0.1.2")).toBe("0.1.2");
  });

  it("ignores ordinary commits", () => {
    // A false positive would tell owners we changed their site when we didn't.
    expect(parseForcedUpdate("lanza: use lanza-site 0.1.4")).toBe(null);
    expect(parseForcedUpdate("chore: bump deps")).toBe(null);
    expect(parseForcedUpdate("")).toBe(null);
    expect(parseForcedUpdate("fix: security: move lanza-site to 0.1.2")).toBe(null);
  });
});

describe("strandsOwner", () => {
  it("flags versions older than the one that added this screen", () => {
    // The real case: a test site went to 0.1.1 and lost the button to come back.
    expect(strandsOwner("0.1.1")).toBe(true);
    expect(strandsOwner("0.1.2")).toBe(true);
  });

  it("does not flag the introducing version or anything newer", () => {
    expect(strandsOwner(SELF_UPDATE_SINCE)).toBe(false);
    expect(strandsOwner("9.9.9")).toBe(false);
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

// 0.1.10 is the first release to carry a two-digit patch. Under string comparison
// "0.1.10" < "0.1.9", which would hide every future update from the Software pane
// and make the critical floor read a newer version as below it — the fan-out would
// then "rescue" sites onto older code. Numeric-segment comparison is what prevents
// that, so pin it.
describe("compareVersions across a two-digit segment", () => {
  it("orders 0.1.10 after 0.1.9", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("0.1.10", "0.1.10")).toBe(0);
  });

  it("does not fall back to lexical order anywhere in the tuple", () => {
    expect(compareVersions("0.1.2", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("10.0.0", "9.0.0")).toBeGreaterThan(0);
  });
});
