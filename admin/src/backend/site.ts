import { reactive } from "vue";
import { GitHubError, type GitHubClient } from "./github";

// Runtime site configuration — the locale set (and onboarding state) the CMS
// edits and stores in the repo at frontend/data/site.json, the SAME file the
// Astro front-end reads (frontend/lib/i18n.ts + astro.config.mjs). The CMS loads
// it at boot through the GitHub proxy (like seo.json/menu.json), so changes the
// onboarding wizard makes take effect on the next load without a rebuild.

export const SITE_CONFIG_PATH = "frontend/data/site.json";

export interface LocaleDef {
  code: string;
  label: string;
  ogLocale?: string;
}

export interface SiteConfigData {
  defaultLocale: string;
  locales: LocaleDef[];
  // Set true by the onboarding wizard once first-run setup is complete.
  onboarded?: boolean;
}

// Pre-onboarding default: a single English locale. Used when site.json is absent
// (a fresh repo) — which also signals "not onboarded yet".
const FALLBACK: SiteConfigData = {
  defaultLocale: "en",
  locales: [{ code: "en", label: "English", ogLocale: "en_US" }],
  onboarded: false,
};

export const site = reactive<{
  defaultLocale: string;
  locales: LocaleDef[];
  onboarded: boolean;
  sha: string | null; // blob sha of site.json, for in-place updates
  loaded: boolean;
}>({
  defaultLocale: FALLBACK.defaultLocale,
  locales: FALLBACK.locales,
  onboarded: false,
  sha: null,
  loaded: false,
});

/** Load site.json via the proxy. A 404 means "no config yet" → first run. */
export async function loadSiteConfig(client: GitHubClient): Promise<void> {
  try {
    const { data, sha } = await client.loadJson(SITE_CONFIG_PATH);
    const locales = Array.isArray(data.locales) && data.locales.length
      ? (data.locales as LocaleDef[])
      : FALLBACK.locales;
    site.defaultLocale = (data.defaultLocale as string) || locales[0].code;
    site.locales = locales;
    site.onboarded = data.onboarded === true;
    site.sha = sha;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      site.defaultLocale = FALLBACK.defaultLocale;
      site.locales = FALLBACK.locales;
      site.onboarded = false;
      site.sha = null;
    } else {
      throw e;
    }
  } finally {
    site.loaded = true;
  }
}

export function localeLabel(code: string): string {
  return site.locales.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

// Languages the onboarding wizard / Languages settings offer to enable.
export const LANG_CATALOG: LocaleDef[] = [
  { code: "en", label: "English", ogLocale: "en_US" },
  { code: "es", label: "Español", ogLocale: "es_ES" },
  { code: "fr", label: "Français", ogLocale: "fr_FR" },
  { code: "de", label: "Deutsch", ogLocale: "de_DE" },
  { code: "it", label: "Italiano", ogLocale: "it_IT" },
  { code: "pt", label: "Português", ogLocale: "pt_PT" },
  { code: "nl", label: "Nederlands", ogLocale: "nl_NL" },
  { code: "ja", label: "日本語", ogLocale: "ja_JP" },
];

// Merge-write a JSON file through the proxy: read the current file, hand its data
// (or {} if absent) to `build` so callers can preserve unknown keys (e.g.
// `onboarded`), then save. The stale-sha 409 retry lives in the client's write
// path, so this stays a thin read-merge helper. Used by the onboarding wizard and
// the Languages settings.
export async function putJsonSafe(
  client: GitHubClient,
  path: string,
  build: (current: Record<string, unknown>) => Record<string, unknown>,
  message: string,
): Promise<void> {
  let current: Record<string, unknown> = {};
  let sha: string | undefined;
  try {
    const j = await client.loadJson(path);
    current = j.data;
    sha = j.sha;
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) throw e;
  }
  await client.saveJson(path, build(current), message, sha);
}
