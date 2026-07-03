import { reactive } from "vue";
import { GitHubError, type GitHubClient } from "./github";
import { setCollections, type Collection } from "../schema";

// Runtime content model — the collections + fields the CMS edits, stored in the
// repo at frontend/data/schema.json (read + write-committed through the GitHub
// proxy, like site.json/menu.json). The CMS loads it at boot and overlays the
// build-time seed baked into schema.ts, so a schema change takes effect on the
// next load without rebuilding the SPA.

export const SCHEMA_PATH = "frontend/data/schema.json";

export const schemaState = reactive<{
  sha: string | null; // blob sha of schema.json, for in-place updates
  loaded: boolean;
}>({
  sha: null,
  loaded: false,
});

/** Load schema.json via the proxy. A 404 means "no committed schema yet" → keep
 *  the seed baked into schema.ts. */
export async function loadSchema(client: GitHubClient): Promise<void> {
  try {
    const { data, sha } = await client.loadJson(SCHEMA_PATH);
    if (Array.isArray(data) && data.length) {
      setCollections(data as Collection[]);
      schemaState.sha = sha;
    }
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      schemaState.sha = null; // no repo copy yet — the seed stands
    } else {
      throw e;
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
