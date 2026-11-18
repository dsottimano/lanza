// The tenant's resolved Brand (frontend/lib/appearance.ts resolveBrand: CSS variables and
// the Google Fonts stylesheet) for CMS surfaces that show tenant content: the page
// preview and the richtext input. Admin chrome keeps its own fonts; callers scope these.
import type { GitHubClient } from "./github";
import { loadAppearance } from "./brand";
import { resolveBrand, type ResolvedBrand } from "../../../frontend/lib/appearance";

const cache = new WeakMap<object, Promise<ResolvedBrand | null>>();

/** Loaded once per client; a missing or unreadable appearance means no overrides. */
export function tenantBrand(client: GitHubClient): Promise<ResolvedBrand | null> {
  let brand = cache.get(client);
  if (!brand) {
    brand = Promise.resolve().then(() => loadAppearance(client))
      .then((a) => resolveBrand({ brand: a.brand } as Parameters<typeof resolveBrand>[0]))
      .catch(() => null);
    cache.set(client, brand);
  }
  return brand;
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
