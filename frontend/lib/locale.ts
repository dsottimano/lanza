// Bilingual routing helpers. Content is NOT translated — Spanish is the default
// (unprefixed) and English lives under /en/*. `mirrorPath` flips a path between
// the two locales for the header's ES · EN switcher.
//
// This is the theme's own UI-only bilingual layer, deliberately separate from
// the platform's content-locale system (frontend/lib/i18n.ts): the site ships a
// single Spanish content set and mirrors it with English chrome, so site.json
// stays single-locale (es) and English is served by the physical /en/* pages.

export type Locale = "es" | "en";

// ES ↔ EN route pairs, most specific first. `sub` matches detail routes only
// (a slug after the prefix), so the bare index falls through to the index pair.
// `collapse` sends a detail path to the other side's index (posts aren't
// translated, so an ES post detail maps to the EN journal index).
interface Pair {
  es: string;
  en: string;
  sub?: boolean;
  collapse?: boolean;
}

const PAIRS: Pair[] = [
  { es: "/posts/", en: "/en/journal/", sub: true, collapse: true }, // post detail → journal index
  { es: "/posts", en: "/en/journal" }, // journal index
  { es: "/", en: "/en/" },
];

const stripSlash = (p: string): string => p.replace(/\/$/, "") || "/";

/** True when `path` is a real English route (/en or /en/...), not e.g. /encuentra. */
function isEnPath(path: string): boolean {
  return path === "/en" || path.startsWith("/en/");
}

function matchFrom(path: string, from: string, sub?: boolean): boolean {
  if (sub) return path.startsWith(from) && path.length > from.length;
  const p = stripSlash(from);
  if (p === "/") return path === "/";
  return path === p || path.startsWith(p + "/");
}

function swap(path: string, from: string, to: string, pr: Pair): string {
  if (pr.collapse) return stripSlash(to);
  if (pr.sub) return to + path.slice(from.length); // `to` ends with "/"
  const f = stripSlash(from);
  const t = stripSlash(to);
  if (f === "/") return t === "/" ? "/" : t + "/";
  const rest = path.slice(f.length);
  if (t === "/") return rest || "/";
  return t + rest || "/";
}

/** Mirror a path to the other locale (ES↔EN). Falls back to the locale home. */
export function mirrorPath(path: string): string {
  const toEn = !isEnPath(path);
  for (const pr of PAIRS) {
    const from = toEn ? pr.es : pr.en;
    const to = toEn ? pr.en : pr.es;
    if (matchFrom(path, from, pr.sub)) return swap(path, from, to, pr);
  }
  return toEn ? "/en/" : "/";
}
