import { GitHubError, type GitHubClient } from "./github";
import { serializeFrontmatter } from "./frontmatter";
import { site, SITE_CONFIG_PATH } from "./site";
import { ruleError, type RedirectRule } from "./redirect-rules";

const REDIRECTS = "data/redirects.json";
const canonical = (path: string) => path === "/" ? path : path.replace(/\/$/, "");
const same = (a: string, b: string) => canonical(a) === canonical(b);

/** Retain old inbound links, collapse chains and permit moving back to a former address. */
export function movedRedirects(rules: RedirectRule[], from: string, to: string): RedirectRule[] {
  rules = rules.map(r => {
    if (!r || typeof r.from !== "string" || typeof r.to !== "string") throw new Error("A stored redirect is malformed. Review Redirects before changing URLs.");
    return { ...r, status: r.status ?? 301 };
  });
  if (same(from, to)) return rules;
  const reachesOld = (start: string): boolean => {
    const visited = new Set<string>();
    let path = start;
    while (!visited.has(canonical(path))) {
      if (same(path, from)) return true;
      visited.add(canonical(path));
      const rule = rules.find(r => same(r.from, path));
      if (!rule || ![301, 308].includes(rule.status)) return false;
      path = rule.to;
    }
    return false;
  };
  for (const r of rules) {
    if (same(r.from, to) && !reachesOld(to)) throw new Error("The new URL already has a redirect. Review it in Redirects first.");
    if (r.from.includes("*") || r.from.includes(":")) {
      const pattern = r.from.split(/([*]|:[a-zA-Z_][\w]*)/).map(part => part === "*" ? ".*" : part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
      if ([to, canonical(to)].some(path => new RegExp(`^${pattern}$`).test(path))) throw new Error("A redirect pattern covers the new URL. Review it in Redirects first.");
    }
  }
  const kept = rules.filter(r => !same(r.from, to) && !same(r.from, from))
    .map(r => reachesOld(r.to) && [301, 308].includes(r.status) ? { ...r, to } : r);
  const added = [{ from, to, status: 301 }];
  if (from !== "/") added.push({ from: canonical(from), to, status: 301 });
  for (const rule of added) {
    const error = ruleError(rule);
    if (error) throw new Error(error);
  }
  const result = [...added, ...kept];
  if (result.filter(r => !/[*:]/.test(r.from)).length > 2000) throw new Error("Redirect limit reached. Review existing redirects before changing this URL.");
  return result;
}

export interface UrlSave {
  collection: string; locale: string; stem: string; slug: string; previousSlug: string;
  path: string; sha?: string; data: Record<string, unknown>; body: string;
}

export async function saveUrlChange(client: GitHubClient, change: UrlSave): Promise<string> {
  const head = await client.workingHead();
  const config = await client.loadJson(SITE_CONFIG_PATH, head);
  const urls = { ...(config.data.urls as Record<string, string> ?? {}) };
  const key = `${change.collection}/${change.locale}/${change.stem}`;
  const fallback = change.collection === "pages" && change.stem === "home" ? "" : change.stem;
  if ((urls[key] ?? fallback) !== change.previousSlug || config.data.defaultLocale !== site.defaultLocale) {
    throw new GitHubError(409, "The URL settings changed elsewhere.");
  }
  if (change.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change.slug)) throw new Error("Use letters, numbers and hyphens in the slug.");
  if (!change.slug && !(change.collection === "pages" && change.stem === "home")) throw new Error("Only the homepage can have an empty slug.");
  const locales = config.data.locales as { code: string }[];
  const reserved = new Set(["404", "style-preview", "admin", "posts", "blog", "category", "tag", "author", "images", "assets", "fonts", "brand", "favicon", "social", "home", ...locales.map(l => l.code)]);
  if (config.data.productSite) for (const value of ["how-it-works", "start", "agents", "architecture"]) reserved.add(value);
  if (change.collection === "pages" && reserved.has(change.slug)) throw new Error("That URL is reserved by the site. Choose another slug.");
  const tree = await client.getTree(head);
  if (tree.truncated) throw new Error("The site is too large to check URL availability. No changes were saved.");
  for (const file of tree.tree) {
    const match = new RegExp(`^content/${change.collection}/(?:(${change.locale})/)?([^/]+)\\.md$`).exec(file.path);
    if (!match || file.path === change.path || (!match[1] && change.locale !== site.defaultLocale)) continue;
    const stem = match[2];
    const used = urls[`${change.collection}/${change.locale}/${stem}`] ?? (change.collection === "pages" && stem === "home" ? "" : stem);
    if (used === change.slug) throw new Error("Another entry already uses that URL. Choose another slug.");
  }
  // Custom collection route prefixes also reserve page slugs.
  const schema = await client.loadJson("data/schema.json", head);
  const collections = Array.isArray(schema.data) ? schema.data : [];
  if (change.collection === "pages" && collections.some((c: { route?: { base?: string } }) => c.route?.base === change.slug)) throw new Error("That URL belongs to a content type.");
  const base = `${change.locale === site.defaultLocale ? "" : "/" + change.locale}/${change.collection === "posts" ? "posts/" : ""}`;
  const pathFor = (slug: string) => `${base}${slug ? slug + "/" : ""}`;
  let redirects: { data: Record<string, unknown>; sha?: string };
  try { redirects = await client.loadJson(REDIRECTS, head); }
  catch (e) { if (!(e instanceof GitHubError && e.status === 404)) throw e; redirects = { data: { redirects: [] } }; }
  if (!Array.isArray(redirects.data.redirects)) throw new Error("Redirects could not be read. Fix data/redirects.json before changing URLs.");
  if (!change.sha) movedRedirects(redirects.data.redirects as RedirectRule[], "/__new-entry-validation__/", pathFor(change.slug));
  const rules = change.sha ? movedRedirects(redirects.data.redirects as RedirectRule[], pathFor(change.previousSlug), pathFor(change.slug)) : redirects.data.redirects;
  const changedUrl = change.slug !== (urls[key] ?? fallback);
  if (changedUrl) urls[key] = change.slug;
  const json = (data: unknown) => JSON.stringify(data, null, 2) + "\n";
  const files = [
    { path: change.path, sha: change.sha, text: serializeFrontmatter(change.data, change.body) },
    ...(changedUrl ? [
      { path: SITE_CONFIG_PATH, sha: config.sha, text: json({ ...config.data, urls }) },
      { path: REDIRECTS, sha: redirects.sha, text: json({ ...redirects.data, redirects: rules }) },
    ] : []),
  ];
  const saved = await client.commitChecked(head, files, `lanza: change URL to ${pathFor(change.slug)} with permanent redirects`);
  site.urls = urls;
  site.sha = saved[SITE_CONFIG_PATH] ?? config.sha;
  return saved[change.path];
}
