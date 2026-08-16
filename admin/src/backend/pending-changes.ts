// The site-wide "what needs me today" list: every file the working branch has that
// production doesn't, classified into things a person can act on.
//
// One request for the whole site. `GET compare/<base>...<head>` returns the file
// list for the entire branch difference, so this costs one call no matter how many
// pages changed — it is allowlisted on the proxy (functions/_lib/gh-proxy.ts, the
// GET arm's `compare/` prefix). Deliberately no file CONTENTS are loaded here: the
// per-field detail of one entry is `loadEntryDiff` in ./entry-diff, called when the
// reviewer opens a row. Loading every file to build a list of rows would turn one
// request into N.
//
// The vocabulary is from the WORKING branch's point of view, because that is the
// side holding the unpublished work: `added` is a file staging has and production
// doesn't, `removed` is one publishing would take down.
import type { GitHubClient } from "./github";
import { REPO, MEDIA, type Locale } from "./config";
import { TEMPLATES_ROOT } from "./templates";
import { folderCollections, type FolderCollection } from "../schema";

export type ChangeStatus = "added" | "modified" | "removed" | "renamed";

/**
 * WHAT changed, not just where. A settings file is not a page, and calling it one
 * is how a review screen starts lying: the union makes `collection`/`slug`/`locale`
 * unreachable on anything that isn't an entry, so the mistake can't compile.
 */
export type ChangeTarget =
  | {
      kind: "entry";
      /** Collection NAME (`posts`), not its folder. */
      collection: string;
      slug: string;
      /** null for a collection shared across languages (authors), or a file at
       *  a localized collection's root (the home page lives there). */
      locale: Locale | null;
    }
  | { kind: "settings"; file: string }
  | { kind: "template"; template: string }
  | { kind: "media"; file: string }
  | { kind: "other" };

export interface PendingChange {
  path: string;
  status: ChangeStatus;
  target: ChangeTarget;
  /**
   * Renames only: where the file was, classified the same way. A slug change is a
   * rename, and comparing the two targets is what tells the caller whether the
   * public URL moved (a redirect concern) or the entry merely moved between
   * locales — neither of which the new path can say on its own.
   */
  previous: { path: string; target: ChangeTarget } | null;
}

// GitHub's diff-entry carries `previous_filename` on a rename. `CompareResult` in
// ./github types only the two fields its existing caller reads, and that file
// belongs to another change right now, so the wider shape is declared here rather
// than widened there. Everything below treats the field as optional anyway: if
// GitHub omits it, the row is still a rename with an unknown origin, not a crash.
interface ComparedFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

// GitHub's own vocabulary → ours. `copied` creates a file that wasn't there, which
// is what `added` means here; `changed` is a content-type/mode change on a file
// that stays put, i.e. modified.
const STATUS: Record<string, ChangeStatus> = {
  added: "added",
  modified: "modified",
  removed: "removed",
  renamed: "renamed",
  copied: "added",
  changed: "modified",
};

function toStatus(raw: string): ChangeStatus {
  // An unrecognized status still means the file differs, and showing the row with
  // the mildest true reading beats dropping a pending change on the floor.
  return STATUS[raw] ?? "modified";
}

// Everything the built site serves as a static asset. MEDIA.dir
// (public/images/uploads) is the subset the CMS uploads into; a theme can add
// others, and they are all media rather than content.
const PUBLIC_ROOT = MEDIA.dir.split("/")[0];
const SETTINGS_ROOT = "data";

/**
 * Which thing in the CMS this repo path IS.
 *
 * Collections come from the live content model, so a tenant that renames a folder
 * doesn't need this file changed; pass an explicit list to classify against a model
 * other than the running one.
 */
export function classifyPath(
  path: string,
  collections: FolderCollection[] = folderCollections(),
): ChangeTarget {
  // Longest folder first: a collection nested inside another's folder must win over
  // its parent, or every one of its entries is filed under the wrong collection.
  const byDepth = [...collections].sort((a, b) => b.folder.length - a.folder.length);
  for (const c of byDepth) {
    const prefix = `${c.folder}/`;
    if (!path.startsWith(prefix) || !path.endsWith(".md")) continue;
    const rest = path.slice(prefix.length).replace(/\.md$/, "");
    const parts = rest.split("/");
    // A localized collection stores folder/<locale>/<slug>, but not everything in
    // it is localized — the home page sits at the collection root.
    const localized = c.localized && parts.length > 1;
    return {
      kind: "entry",
      collection: c.name,
      slug: localized ? parts.slice(1).join("/") : rest,
      locale: localized ? parts[0] : null,
    };
  }

  if (path.startsWith(`${SETTINGS_ROOT}/`) && path.endsWith(".json")) {
    return { kind: "settings", file: path };
  }
  if (path.startsWith(`${TEMPLATES_ROOT}/`)) {
    // templates/<name>/… — the dir name IS the page's `preset`.
    return { kind: "template", template: path.slice(TEMPLATES_ROOT.length + 1).split("/")[0] };
  }
  if (path.startsWith(`${PUBLIC_ROOT}/`)) {
    return { kind: "media", file: path };
  }
  // Config, source, anything a person edited on GitHub directly. Still pending, and
  // still shown — just not claimed to be something it isn't.
  return { kind: "other" };
}

/**
 * Everything waiting to be published, one row per file.
 *
 * An empty array is the healthy answer, not a failure: it means production already
 * matches the working branch and there is nothing to review. GitHub omits `files`
 * entirely when the two refs are identical, which reads the same way.
 */
export async function loadPendingChanges(
  client: GitHubClient,
  collections?: FolderCollection[],
): Promise<PendingChange[]> {
  const result = await client.compare(REPO.productionBranch, REPO.branch);
  const files = (result.files ?? []) as ComparedFile[];
  return files.map((f) => {
    const previous = f.previous_filename;
    return {
      path: f.filename,
      status: toStatus(f.status),
      target: classifyPath(f.filename, collections),
      previous: previous
        ? { path: previous, target: classifyPath(previous, collections) }
        : null,
    };
  });
}

/**
 * Did this change move a published URL? True only for a rename that alters an
 * entry's slug or locale — the case that needs a redirect, as opposed to a rename
 * of a template or a media file, which no one has bookmarked.
 */
export function movedPublicUrl(change: PendingChange): boolean {
  const to = change.target;
  const from = change.previous?.target;
  if (!from || to.kind !== "entry" || from.kind !== "entry") return false;
  return from.slug !== to.slug || from.locale !== to.locale;
}
