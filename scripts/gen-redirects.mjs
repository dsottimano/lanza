// Compiles the CMS-editable frontend/data/redirects.json into Cloudflare's native
// public/_redirects file. Runs before `astro build`.
//
// The JSON is CMS/git-edited untrusted input compiled straight into a routing
// config, so every rule is validated: an embedded newline or space would
// otherwise inject arbitrary redirect rules (e.g. one shadowing /admin/*).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dataPath = fileURLToPath(new URL("../frontend/data/redirects.json", import.meta.url));
const outPath = fileURLToPath(new URL("../public/_redirects", import.meta.url));

// Status codes Cloudflare's _redirects supports (200 = rewrite/proxy).
const OK_STATUS = new Set([200, 301, 302, 303, 307, 308]);
// A single token: a leading slash then no whitespace (blocks newline injection).
const PATH_RE = /^\/\S+$/;

// `from` shadows /admin if its literal prefix (before any `*` splat) is a prefix
// of "/admin" (e.g. "/", "/ad") or sits under it ("/admin", "/admin/x").
function shadowsAdmin(from) {
  const prefix = from.split("*")[0];
  return "/admin".startsWith(prefix) || prefix.startsWith("/admin");
}

function isValidTo(to) {
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

function isValid(r) {
  if (!r || typeof r.from !== "string" || typeof r.to !== "string") return false;
  const status = r.status ?? 301;
  if (!PATH_RE.test(r.from)) return false;
  if (r.from.startsWith("//")) return false; // protocol-relative — not a site path
  if (shadowsAdmin(r.from)) return false;
  if (!isValidTo(r.to)) return false;
  if (!OK_STATUS.has(status)) return false;
  return true;
}

const { redirects = [] } = JSON.parse(readFileSync(dataPath, "utf8"));
const lines = [];
for (const r of redirects) {
  if (!isValid(r)) {
    console.warn(`gen-redirects: skipping invalid rule ${JSON.stringify(r)}`);
    continue;
  }
  lines.push(`${r.from} ${r.to} ${r.status ?? 301}`);
}

writeFileSync(outPath, lines.length ? lines.join("\n") + "\n" : "");
console.log(`gen-redirects: wrote ${lines.length} rule(s) to public/_redirects`);
