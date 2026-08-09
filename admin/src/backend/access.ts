import { reactive } from "vue";
import type { GitHubClient } from "./github";
import { REPO } from "./config";

// Who is signed in, and what they are allowed to do — the CMS's read-only view of
// the rule enforced on the server in functions/_lib/roles.ts.
//
// This decides what the UI OFFERS. It decides nothing about what is permitted: the
// gh proxy re-checks every write against the same lanza.config.json regardless of
// what this module believes, and an editor who forges a request here gets a 403
// from the server, not a broken site. Hiding a button the server would refuse is a
// courtesy to honest users, not a security boundary — treating it as one is exactly
// the mistake security-model.md I1 is about.
//
// The config is read from the PRODUCTION branch on purpose. It is the deployed copy
// that the Pages Function actually imports at build time, so it is the only copy
// that reflects who can currently log in. A pending edit on staging says who WILL be
// able to, once published and rebuilt — which is precisely the distinction the
// People panel has to show the owner rather than hide.

export const ACCESS_CONFIG_PATH = "lanza.config.json";

export type Role = "owner" | "editor";

export interface AccessState {
  login: string | null;
  role: Role | null;
  /** Owner logins, from `adminLogin` (a comma list, historically). */
  owners: string[];
  /** Invited content editors, from `editors`. */
  editors: string[];
  /** Blob sha of lanza.config.json on the working branch, for in-place saves. */
  sha: string | null;
  loaded: boolean;
}

export const access = reactive<AccessState>({
  login: null,
  role: null,
  owners: [],
  editors: [],
  sha: null,
  loaded: false,
});

/** True when the signed-in user may publish and change settings. */
export function isOwner(): boolean {
  return access.role === "owner";
}

/** Normalise either stored form (comma string or array) to a list of logins. */
export function toLoginList(value: unknown): string[] {
  const raw =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const login = entry.trim();
    if (!login) continue;
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(login);
  }
  return out;
}

/**
 * A GitHub username, by GitHub's own rule: alphanumerics and single hyphens, not
 * leading or trailing, 39 characters max. Validated here so a typo is caught while
 * the owner is looking at the field rather than becoming a login that can never
 * match anyone — the failure mode of a bad entry is silent (someone simply cannot
 * get in), so it has to be refused at the point of entry.
 */
export function isValidLogin(login: string): boolean {
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login);
}

export function findRole(login: string | null, owners: string[], editors: string[]): Role | null {
  if (!login) return null;
  const who = login.toLowerCase();
  if (owners.some((o) => o.toLowerCase() === who)) return "owner";
  if (editors.some((e) => e.toLowerCase() === who)) return "editor";
  return null;
}

/**
 * Load the signed-in login and the deployed access lists. Never throws: the CMS
 * must still open if this fails, and it fails CLOSED — an unknown role is treated
 * as an editor by every caller, so a hiccup here hides owner controls rather than
 * offering them to someone who may not have them.
 */
export async function loadAccess(client: GitHubClient): Promise<void> {
  try {
    access.login = await client.getLogin();
  } catch {
    access.login = null;
  }
  try {
    const live = await client.loadJson(ACCESS_CONFIG_PATH, REPO.productionBranch);
    access.owners = toLoginList(live.data.adminLogin);
    access.editors = toLoginList(live.data.editors);
  } catch {
    access.owners = [];
    access.editors = [];
  }
  try {
    // The working-branch copy is what a save must update (and its sha is the one
    // GitHub will accept). A 404 here just means no pending edit yet.
    const working = await client.loadJson(ACCESS_CONFIG_PATH);
    access.sha = working.sha;
  } catch {
    access.sha = null;
  }
  access.role = findRole(access.login, access.owners, access.editors);
  access.loaded = true;
}

/**
 * Write the editor list to the working branch. Returns the new sha.
 *
 * Only ever touches `editors`: the rest of lanza.config.json (owner, name,
 * adminLogin, domains, pagesProject) is read and written back unchanged, so this
 * cannot drop a field it does not know about — and cannot change who the OWNERS
 * are, which is a deliberate limit rather than an oversight. Promoting someone is a
 * repo edit, on purpose.
 */
export async function saveEditors(client: GitHubClient, editors: string[]): Promise<void> {
  const current = await client.loadJson(ACCESS_CONFIG_PATH);
  const next = { ...current.data, editors: toLoginList(editors) };
  access.sha = await client.saveJson(
    ACCESS_CONFIG_PATH,
    next,
    "lanza: update who can edit this site",
    current.sha,
  );
  access.editors = next.editors;
}
