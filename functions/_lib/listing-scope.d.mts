export interface ListingOptions { item: string[]; date?: string; latest?: number }
export const LATEST_MAX: number;
export const LISTING_DATE_NAMES: string[];
export const LISTING_SPLIT_LISTS: string[];
export const LISTING_SPLIT_FLAGS: string[];
export function listingOptionErrors(listing: unknown): string[];
export function dateOf(value: unknown): Date | null;
export function longDate(date: Date, locale: string): string;
export function listingItem(data: Record<string, unknown>, listing: ListingOptions, locale: string): Record<string, unknown>;
export function listingParts<T extends Record<string, unknown>>(
  items: T[],
  listing: ListingOptions,
  recordsOf: (item: T) => Record<string, unknown>,
): { scope: Record<string, unknown>; fields: Record<string, unknown> };
