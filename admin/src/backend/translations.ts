// Which languages an entry already exists in — the data behind the entry editor's
// locale bar.
//
// Translations are linked IMPLICITLY, by filename stem: content/pages/en/about.md
// and content/pages/es/about.md are the same page in two languages. That is the same
// rule the build uses for hreflang and the public language switcher
// (frontend/lib/alternates.ts), but the build can index the whole content tree once
// while the CMS has to answer for ONE entry, live, against the working branch — so
// this asks GitHub for each locale's directory instead.
import type { GitHubClient } from "./github";
import { entryFolder, type FolderCollection } from "../schema";
import type { Locale } from "./config";

/** An entry path's stem (filename without `.md`); "" for a new entry. */
export function stemOf(path: string | null): string {
  return path ? path.replace(/\.md$/, "").split("/").pop()! : "";
}

/**
 * The locales, out of `locales`, whose folder holds `<stem>.md` for this collection.
 * An empty stem (a brand-new entry) exists nowhere yet.
 */
export async function findTranslations(
  client: GitHubClient,
  collection: FolderCollection,
  stem: string,
  locales: readonly Locale[],
): Promise<Set<Locale>> {
  if (!stem) return new Set();
  const file = `${stem}.md`;

  // A shared (non-localized) collection keeps one folder for every language, so an
  // entry that exists at all exists in all of them — one lookup, not N identical ones.
  if (!collection.localized) {
    const files = await client.listDir(collection.folder);
    return files.some((f) => f.name === file) ? new Set(locales) : new Set();
  }

  const found = await Promise.all(
    locales.map(async (code) => {
      const files = await client.listDir(entryFolder(collection, code));
      return files.some((f) => f.name === file) ? code : null;
    }),
  );
  return new Set(found.filter((code): code is Locale => code !== null));
}

// ── creating a missing translation ─────────────────────────────────────────

// Frontmatter a new translation inherits. Structure, never prose: copying the
// English words into /es and publishing them is WORSE than an empty page, because it
// looks translated. So the shell keeps only what is language-independent — which
// template renders the page, and that template's slot KEYS with their values emptied,
// so the fields a human or an agent has to fill are already laid out in the right
// shape. Everything else (title, description, SEO, categories) is dropped.
const STRUCTURAL = ["preset", "template"] as const;

/** The empty shell of `source` in another language: its structure, none of its words. */
export function translationShell(source: Record<string, unknown>): Record<string, unknown> {
  const shell: Record<string, unknown> = {};
  for (const key of STRUCTURAL) {
    if (source[key] !== undefined) shell[key] = source[key];
  }
  if (source.slots && typeof source.slots === "object") {
    shell.slots = emptyValues(source.slots);
  }
  // A page with no words in it must never be publishable by accident.
  shell.draft = true;
  return shell;
}

// Strip the text out of a slot tree while keeping its shape: strings blank, lists the
// same length (three cards is structure — what the cards SAY is not), numbers and
// booleans kept because they are settings rather than copy.
function emptyValues(value: unknown): unknown {
  if (typeof value === "string") return "";
  if (Array.isArray(value)) return value.map(emptyValues);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, emptyValues(v)]),
    );
  }
  return value;
}

// The shell has to survive one navigation: the locale bar builds it from the entry on
// screen, then routes to a NEW entry in the other language, which mounts a fresh
// editor. Parking it here is deliberate over stuffing frontmatter into the URL. A
// reload loses it — but the slug travels in the query string, so the worst case is an
// unpicked template, never the wrong prose.
interface TranslationSeed {
  collection: string;
  locale: Locale;
  slug: string;
  data: Record<string, unknown>;
}
let pending: TranslationSeed | null = null;

/** Park a shell for the editor that is about to mount. */
export function setTranslationSeed(seed: TranslationSeed): void {
  pending = seed;
}

/** Take the parked shell, once, if it was meant for exactly this editor. */
export function takeTranslationSeed(
  collection: string,
  locale: Locale,
  slug: string,
): Record<string, unknown> | null {
  if (
    !pending ||
    pending.collection !== collection ||
    pending.locale !== locale ||
    pending.slug !== slug
  ) {
    return null;
  }
  const { data } = pending;
  pending = null;
  return data;
}
