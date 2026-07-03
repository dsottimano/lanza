// Listing presentation helpers — the only locale-aware layer (content itself is
// Spanish on both sides; these translate price/status labels and build URLs).
import type { Locale } from "./locale";

export type { Locale };

interface Priceable {
  listingType?: string;
  priceSale?: number;
  priceRent?: number;
}

export function formatPrice(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

const PER_MONTH: Record<Locale, string> = { es: "/ mes", en: "/ month" };
const CONSULT: Record<Locale, string> = { es: "Precio a consultar", en: "Price on request" };

export function priceLine(l: Priceable, locale: Locale): string {
  const parts: string[] = [];
  if ((l.listingType === "sale" || l.listingType === "sale_and_rent") && l.priceSale)
    parts.push(formatPrice(l.priceSale));
  if ((l.listingType === "rent" || l.listingType === "sale_and_rent") && l.priceRent)
    parts.push(`${formatPrice(l.priceRent)} ${PER_MONTH[locale]}`);
  return parts.length ? parts.join(" · ") : CONSULT[locale];
}

const STATUS_LABELS: Record<string, Record<Locale, string>> = {
  active: { es: "Disponible", en: "Available" },
  under_offer: { es: "En negociación", en: "Under offer" },
  sold: { es: "Vendida", en: "Sold" },
  rented: { es: "Alquilada", en: "Rented" },
};

export function statusBadge(status: string | undefined, locale: Locale): { label: string; cls: string } {
  const key = status && STATUS_LABELS[status] ? status : "active";
  return { label: STATUS_LABELS[key][locale], cls: `lp-badge--${key}` };
}

/** ES listing detail lives at /p/<slug>; EN at /en/properties/<slug>. */
export function listingUrl(slug: string, locale: Locale): string {
  return locale === "en" ? `/en/properties/${slug}` : `/p/${slug}`;
}

/** UI strings shared across the real-estate pages. */
export const UI: Record<Locale, Record<string, string>> = {
  es: {
    properties: "Propiedades",
    viewAll: "Ver todas",
    seeProperties: "Ver propiedades",
    journal: "Journal",
    regions: "Regiones",
    recentlyListed: "Recién listadas",
    beds: "hab",
    baths: "baños",
    contact: "Contactar",
    read: "Leer",
    backToProperties: "← Volver a propiedades",
    similar: "Propiedades similares",
    allRegions: "Todas",
  },
  en: {
    properties: "Properties",
    viewAll: "View all",
    seeProperties: "View properties",
    journal: "Journal",
    regions: "Regions",
    recentlyListed: "Recently listed",
    beds: "bd",
    baths: "ba",
    contact: "Contact",
    read: "Read",
    backToProperties: "← Back to properties",
    similar: "Similar properties",
    allRegions: "All",
  },
};
