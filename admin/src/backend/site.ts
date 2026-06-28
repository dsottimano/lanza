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
