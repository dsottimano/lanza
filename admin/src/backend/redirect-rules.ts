// Redirect-rule validation for the CMS Redirects editor.
//
// This MIRRORS the validation in scripts/gen-redirects.mjs (the build step that
// compiles data/redirects.json into Cloudflare's native _redirects
// file). They live in separate build roots — this is Vite/TS, that is Node ESM —
// so the logic is duplicated on purpose, the same way frontend/lib/site.ts and
// admin/src/backend/menu.ts mirror each other. If you change a rule here, change
// it there too, and vice versa. The core predicates below are byte-for-byte
// equivalent to that file so the editor never marks a rule valid that the build
// would drop (or vice versa). `ruleError() === null` iff gen-redirects `isValid()`.

// Status codes Cloudflare's _redirects supports (200 = rewrite/proxy).
export const OK_STATUS = [200, 301, 302, 303, 307, 308] as const;
export type RedirectStatus = (typeof OK_STATUS)[number];
const OK_STATUS_SET = new Set<number>(OK_STATUS);

// Human labels for the compact status <select>.
export const STATUS_LABELS: Record<RedirectStatus, string> = {
  301: "301 · Permanent",
  302: "302 · Temporary",
  308: "308 · Permanent (keep method)",
  307: "307 · Temporary (keep method)",
  303: "303 · See other",
  200: "200 · Rewrite (proxy)",
};

// Order shown in the select — permanent/temporary first (the common cases).
export const STATUS_OPTIONS: RedirectStatus[] = [301, 302, 308, 307, 303, 200];

export interface RedirectRule {
  from: string;
  to: string;
  status: number;
}

// A single token: a leading slash then no whitespace (blocks newline injection).
const PATH_RE = /^\/\S+$/;

// `from` shadows /admin if its literal prefix (before any `*` splat) is a prefix
// of "/admin" (e.g. "/", "/ad") or sits under it ("/admin", "/admin/x").
// (Mirror of gen-redirects.mjs shadowsAdmin.)
function shadowsAdmin(from: string): boolean {
  const prefix = from.split("*")[0];
  return "/admin".startsWith(prefix) || prefix.startsWith("/admin");
}

// (Mirror of gen-redirects.mjs isValidTo.)
function isValidTo(to: string): boolean {
  // Site-relative path: leading slash, no whitespace. Allow bare "/" (root);
  // reject protocol-relative "//host".
  if (/^\/\S*$/.test(to) && !to.startsWith("//")) return true;
  try {
    const u = new URL(to);
    return (u.protocol === "http:" || u.protocol === "https:") && !/\s/.test(to);
  } catch {
    return false;
  }
}

/**
 * Hard validation — parity with gen-redirects.mjs isValid(). Returns a specific,
 * user-facing message for the FIRST failing check (checked in the same order the
 * build uses), or null when the rule is valid. A rule with a message here is one
 * the build will skip.
 */
export function ruleError(r: RedirectRule): string | null {
  const from = r.from.trim();
  const to = r.to.trim();
  if (!from || !to) return "Both From and To are required.";

  if (!PATH_RE.test(from)) {
    if (!from.startsWith("/")) return "From must start with a slash (e.g. /old-page).";
    if (/\s/.test(from)) return "From can’t contain spaces.";
    return "From must be a path like /old-page.";
  }
  if (from.startsWith("//")) return "From isn’t a valid site path (remove the leading //).";
  if (shadowsAdmin(from)) return "This pattern would cover /admin — not allowed.";
  if (!isValidTo(to)) return "To must be a site path (/page) or a full https:// URL, with no spaces.";
  if (!OK_STATUS_SET.has(r.status)) return "Unsupported status code.";
  return null;
}

/**
 * Softer, non-blocking warnings — things that are technically valid but usually
 * a mistake. `index` is this rule's position; `all` is the full ordered list
 * (rules apply top-down). Returns zero or more short messages.
 */
export function ruleWarnings(r: RedirectRule, all: RedirectRule[], index: number): string[] {
  const warnings: string[] = [];
  const from = r.from.trim();
  const to = r.to.trim();
  if (!from || !to) return warnings; // incomplete row — nothing useful to warn about

  if (from === to) {
    warnings.push("From and To are identical — this redirect does nothing.");
  }

  // An earlier rule with the same `from` wins (top-down), so this one never runs.
  const firstIdx = all.findIndex((o) => o.from.trim() === from);
  if (firstIdx !== -1 && firstIdx < index) {
    warnings.push("Another rule above already redirects this path — this one is unreachable.");
  }

  // Simple two-hop loop: some other rule sends `to` back to `from`.
  if (from !== to && all.some((o, i) => i !== index && o.from.trim() === to && o.to.trim() === from)) {
    warnings.push("This forms a redirect loop with another rule (A → B → A).");
  }

  // Trailing-slash mismatch between two site paths is a common cause of surprise
  // double-redirects. Only compare when both sides are site-relative paths.
  if (
    from.startsWith("/") &&
    to.startsWith("/") &&
    !to.startsWith("//") &&
    from !== to &&
    from.endsWith("/") !== to.endsWith("/")
  ) {
    warnings.push("Trailing slash differs between From and To.");
  }

  return warnings;
}

/** Coerce a raw JSON entry into an editable row, defaulting status to 301. */
export function normalizeRule(raw: unknown): RedirectRule {
  const o = (raw ?? {}) as Record<string, unknown>;
  const status = typeof o.status === "number" ? o.status : 301;
  return {
    from: typeof o.from === "string" ? o.from : "",
    to: typeof o.to === "string" ? o.to : "",
    status,
  };
}
