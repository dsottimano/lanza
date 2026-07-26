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

/** Compare two dotted numeric versions. -1 / 0 / 1, like a sort comparator. */
export function compareVersions(a: string, b: string): number {
  // Prerelease suffixes (1.2.3-beta.1) sort BEFORE their release, per semver.
  const [aMain, aPre] = a.split("-", 2);
  const [bMain, bPre] = b.split("-", 2);
  const an = aMain.split(".").map((n) => parseInt(n, 10) || 0);
  const bn = bMain.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(an.length, bn.length); i++) {
    const d = (an[i] ?? 0) - (bn[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre && aPre !== bPre) return aPre < bPre ? -1 : 1;
  return 0;
}

/** The pinned version string, with any range prefix stripped (we pin exact). */
function pinnedVersion(pkg: Record<string, unknown>): string | null {
  const deps = pkg.dependencies as Record<string, string> | undefined;
  const raw = deps?.[PACKAGE_NAME];
  return raw ? raw.replace(/^[\^~>=<\s]+/, "") : null;
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
  const releases = Object.keys(doc.versions ?? {})
    .sort((a, b) => compareVersions(b, a))
    .map((version) => ({ version, date: doc.time?.[version] ?? null }));
  return { latest: tags.latest ?? "", critical: tags.critical ?? null, releases };
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
  const { data, sha } = await client.loadJson("package.json", REPO.branch);
  const deps = (data.dependencies ?? {}) as Record<string, string>;
  if (deps[PACKAGE_NAME] === version) return;
  data.dependencies = { ...deps, [PACKAGE_NAME]: version };
  await client.saveJson("package.json", data, `lanza: use ${PACKAGE_NAME} ${version}`, sha);
}
