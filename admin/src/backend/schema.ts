import { reactive } from "vue";
import { GitHubError, type GitHubClient } from "./github";
import { REPO } from "./config";
import { setCollections, type Collection } from "../schema";

// Runtime content model — the collections + fields the CMS edits, stored in the
// repo at data/schema.json (read + write-committed through the GitHub
// proxy, like site.json/menu.json). The CMS loads it at boot and overlays the
// build-time seed baked into schema.ts, so a schema change takes effect on the
// next load without rebuilding the SPA.

export const SCHEMA_PATH = "data/schema.json";

export const schemaState = reactive<{
  sha: string | null; // blob sha of schema.json, for in-place updates
  loaded: boolean;
}>({
  sha: null,
  loaded: false,
});

/** Load schema.json via the proxy. Reads the working branch; on a 404 (fresh
 *  working branch, ref lag) falls back to production. A 404 on both means no
 *  committed schema yet → keep the seed baked into schema.ts. */
export async function loadSchema(client: GitHubClient): Promise<void> {
  try {
    let loaded: { data: unknown; sha: string | null } | null;
    try {
      loaded = await client.loadJson(SCHEMA_PATH);
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
      try {
        const prod = await client.loadJson(SCHEMA_PATH, REPO.productionBranch);
        loaded = { data: prod.data, sha: null };
      } catch (e2) {
        if (!(e2 instanceof GitHubError && e2.status === 404)) throw e2;
        loaded = null; // no repo copy on either branch — the seed stands
      }
    }
    if (loaded && Array.isArray(loaded.data) && loaded.data.length) {
      setCollections(loaded.data as Collection[]);
      schemaState.sha = loaded.sha;
    } else {
      schemaState.sha = null;
    }
  } finally {
    schemaState.loaded = true;
  }
}

/** Commit the model to schema.json and apply it to the live store. */
export async function saveSchema(client: GitHubClient, list: Collection[]): Promise<void> {
  const sha = await client.saveJson(
    SCHEMA_PATH,
    list,
    `lanza: update ${SCHEMA_PATH}`,
    schemaState.sha ?? undefined,
  );
  schemaState.sha = sha;
  setCollections(list);
}
