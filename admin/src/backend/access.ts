import { reactive } from "vue";
import type { GitHubClient } from "./github";

// Who is signed in, and what they are allowed to do — the CMS's read-only view of
// the answer GITHUB gave the gate (`permissions` on this repo).
//
// This decides what the UI OFFERS. It decides nothing about what is permitted: the
// gh proxy re-asks on every write regardless of what this module believes, and an
// editor who forges a request here gets a 403 from the server, not a broken site.
// Hiding a button the server would refuse is a courtesy to honest users, not a
// security boundary — treating it as one is exactly the mistake security-model.md
// I1 is about.
//
// There used to be lists here (`adminLogin`, `editors` in lanza.config.json), read
// from the production branch and maintained in a People panel. They are gone: a
// list of our own is a second, drifting answer to a question GitHub already answers,
// and removing someone from it never actually took their access away. Collaborators
// are managed on GitHub, and a removal takes effect within 60 seconds.

export type Role = "owner" | "editor" | "viewer";

export interface AccessState {
  login: string | null;
  role: Role | null;
  /** `owner/name` of the repository this CMS edits, for links into GitHub. */
  repo: string | null;
  loaded: boolean;
}

export const access = reactive<AccessState>({
  login: null,
  role: null,
  repo: null,
  loaded: false,
});

/** True when the signed-in user may publish and change settings. */
export function isOwner(): boolean {
  return access.role === "owner";
}

/**
 * Load who is signed in and what they may do. Never throws: the CMS must still open
 * if this fails, and it fails CLOSED — a null role is treated as the least
 * privileged by every caller, so a hiccup here hides owner controls rather than
 * offering them to someone who may not have them.
 */
export async function loadAccess(client: GitHubClient): Promise<void> {
  try {
    const identity = await client.getIdentity();
    access.login = identity.login;
    access.role = identity.role;
    access.repo = identity.repo;
  } catch {
    access.login = null;
    access.role = null;
    access.repo = null;
  }
  access.loaded = true;
}
