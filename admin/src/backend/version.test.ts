import { describe, it, expect, vi, afterEach } from "vitest";
import {
  compareVersions,
  isVersion,
  fetchRegistry,
  loadVersionState,
  setPinnedVersion,
  updateAvailable,
  securityUpdateRequired,
  strandsOwner,
  isUnsafeVersion,
  parseForcedUpdate,
  SELF_UPDATE_SINCE,
  type VersionState,
} from "./version";
import type { GitHubClient } from "./github";

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

// The same lexical trap, one level down. Not reachable while releases stay 0.1.x
// with no prereleases — it goes live the moment a `-rc` is published, and tagging
// one `critical` would move the whole fleet onto a prerelease in the wrong order.
describe("compareVersions inside the prerelease suffix", () => {
  it("keeps the WHOLE suffix, not just up to the first hyphen", () => {
    // split("-", 2) discarded everything past the first hyphen, so these compared
    // EQUAL and neither the CMS nor the fan-out could tell them apart.
    expect(compareVersions("1.0.0-beta-1", "1.0.0-beta-2")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta-2", "1.0.0-beta-1")).toBeGreaterThan(0);
  });

  it("orders numeric prerelease identifiers numerically", () => {
    expect(compareVersions("1.0.0-rc.10", "1.0.0-rc.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
  });

  it("follows semver §11 for mixed and shorter identifier sets", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
  });
});

// The value written here is the VALUE of dependencies["lanza-site"], which npm
// reads as a dependency SPECIFIER. `0.1.6 || https://evil.example/p.tgz` compares
// as newer than 0.1.5, clears the critical floor, and npm then installs from that
// URL — nothing published, nothing for provenance to catch.
const SPECIFIER_INJECTION = "0.1.6 || https://evil.example/p.tgz";

describe("isVersion", () => {
  it("accepts released version numbers", () => {
    expect(isVersion("0.1.10")).toBe(true);
    expect(isVersion("1.0.0-rc.1")).toBe(true);
  });

  it("refuses anything that is a dependency specifier rather than a number", () => {
    for (const bad of [
      SPECIFIER_INJECTION,
      "https://evil.example/p.tgz",
      "file:../lanza",
      "github:attacker/lanza-site",
      "npm:evil@1.0.0",
      "*",
      "latest",
      "^0.1.1",
      "0.1", // not a full triple
      " 0.1.6",
      "0.1.6\n",
      "",
      null,
      undefined,
      123,
    ]) {
      expect(isVersion(bad), String(bad)).toBe(false);
    }
  });
});

/** A GitHubClient that records writes instead of making them. */
function spyClient(pkg: Record<string, unknown>) {
  const writes: string[] = [];
  const client = {
    loadJson: async () => ({ data: structuredClone(pkg), sha: "sha1" }),
    saveJson: async (path: string) => {
      writes.push(`save ${path}`);
    },
    deleteFileIfExists: async (path: string) => {
      writes.push(`delete ${path}`);
    },
    listCommits: async () => [],
  } as unknown as GitHubClient;
  return { client, writes };
}

describe("setPinnedVersion", () => {
  const pkg = { dependencies: { "lanza-site": "0.1.5" } };

  it("refuses a specifier and writes NOTHING", async () => {
    const { client, writes } = spyClient(pkg);
    await expect(setPinnedVersion(client, SPECIFIER_INJECTION)).rejects.toThrow(
      /not a version number/,
    );
    // Not even the lockfile delete — the guard runs before any GitHub call.
    expect(writes).toEqual([]);
  });

  it("still pins a real version", async () => {
    const { client, writes } = spyClient(pkg);
    await setPinnedVersion(client, "0.1.10");
    expect(writes).toEqual(["delete package-lock.json", "save package.json"]);
  });
});

describe("fetchRegistry", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubRegistry(doc: unknown) {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(doc), { status: 200 }));
  }

  it("drops a dist-tag that is not a version number", async () => {
    // A hostile or malformed tag must read as ABSENT: no latest → no offer, no
    // critical → no floor. Both are the existing safe defaults.
    stubRegistry({
      "dist-tags": { latest: SPECIFIER_INJECTION, critical: "file:../evil" },
      versions: { "0.1.5": {}, "0.1.10": {} },
    });
    const info = await fetchRegistry();
    expect(info.latest).toBe("");
    expect(info.critical).toBe(null);
  });

  it("drops a version key that is not a version number", async () => {
    // Every key becomes a clickable Update button.
    stubRegistry({
      "dist-tags": { latest: "0.1.10" },
      versions: { "0.1.9": {}, "0.1.10": {}, [SPECIFIER_INJECTION]: {} },
    });
    const info = await fetchRegistry();
    expect(info.releases.map((r) => r.version)).toEqual(["0.1.10", "0.1.9"]);
  });
});

describe("a pin that is not a release reads as unmanaged", () => {
  // Matches the broker's verdictFor: a self-hoster on file:, a fork on a git URL
  // or anyone on `*` is not a site running a release. Judging them version 0 made
  // the CMS nag them and the fan-out force-rewrite their repo.
  async function stateFor(pin: string) {
    const { client } = spyClient({ dependencies: { "lanza-site": pin } });
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    try {
      return await loadVersionState(client);
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("treats file:/git/star pins as no pin at all", async () => {
    for (const pin of ["file:../lanza", "github:someone/lanza-site", "*", "latest"]) {
      const s = await stateFor(pin);
      expect(s.live, pin).toBe(null);
      expect(s.unmanaged, pin).toBe(true);
    }
  });

  it("still reads a normal pin, with or without a range prefix or a leading v", async () => {
    expect((await stateFor("0.1.10")).live).toBe("0.1.10");
    expect((await stateFor("^0.1.10")).live).toBe("0.1.10");
    // v1.0.0 used to parse to [0,0,0] and read as ancient — below every floor.
    expect((await stateFor("v1.0.0")).live).toBe("1.0.0");
  });
});
