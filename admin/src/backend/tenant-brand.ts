// The tenant's resolved Brand (frontend/lib/appearance.ts resolveBrand: CSS variables and
// the Google Fonts stylesheet) for CMS surfaces that show tenant content: the page
// preview and the richtext input. Admin chrome keeps its own fonts; callers scope these.
import type { GitHubClient } from "./github";
import { loadAppearance } from "./brand";
import { resolveBrand, type ResolvedBrand } from "../../../frontend/lib/appearance";

const cache = new WeakMap<object, Promise<ResolvedBrand | null>>();

/**
 * Loaded once per client until Brand is saved (forgetTenantBrand). A failed load means
 * no overrides for now and is not cached, so the next caller retries.
 */
export function tenantBrand(client: GitHubClient): Promise<ResolvedBrand | null> {
  let brand = cache.get(client);
  if (!brand) {
    const loading = Promise.resolve().then(() => loadAppearance(client))
      .then((a) => resolveBrand({ brand: a.brand } as Parameters<typeof resolveBrand>[0]))
      .catch(() => { if (cache.get(client) === loading) cache.delete(client); return null; });
    brand = loading;
    cache.set(client, brand);
  }
  return brand;
}

/** Called after a Brand save so the next richtext input or preview reads it. */
export function forgetTenantBrand(client: GitHubClient): void {
  cache.delete(client);
}

/** Only the font variables, for a scope inside admin chrome. */
export function fontVars(brand: ResolvedBrand | null): string {
  return (brand?.styleVars ?? "").split(";").filter((d) => /^--font-(heading|prose):/.test(d)).join(";");
}

/** One shared stylesheet link in the admin document for the tenant's fonts. */
export function addFontStylesheet(href: string | null): void {
  if (!href || typeof document === "undefined") return;
  let link = document.getElementById("lz-tenant-fonts") as HTMLLinkElement | null;
  if (!link) {
    link = Object.assign(document.createElement("link"), { id: "lz-tenant-fonts", rel: "stylesheet" });
    document.head.append(link);
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}
