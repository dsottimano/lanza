import type { GitHubClient } from './github';
import { getCollection } from '../schema';
import { entryPath } from './site-urls';

export async function loadPageListing(client: GitHubClient, preset: string, locale: string): Promise<Record<string, unknown>> {
  const { data } = await client.loadJson(`templates/${preset}/fields.json`);
  const listing = data.listing as { of: string; item: string[]; sortBy?: string; order?: string } | undefined;
  if (!listing) return {};
  const collection = getCollection(listing.of);
  if (!collection || collection.kind !== 'folder') throw new Error('Unknown listing collection');
  const folder = collection.folder + (collection.localized ? `/${locale}` : '');
  const files = await client.listDir(folder);
  const loaded = await Promise.all(files.map(async file => ({ file, entry: await client.loadEntry(file.path) })));
  const key = listing.sortBy ?? 'title';
  const direction = listing.order === 'desc' ? -1 : 1;
  const entries = loaded.filter(({ entry }) => entry.data.draft !== true)
    .sort((a, b) => {
      const left = a.entry.data[key];
      const right = b.entry.data[key];
      return direction * (left instanceof Date && right instanceof Date ? +left - +right : String(left ?? '').localeCompare(String(right ?? '')));
    }).map(({ file, entry }) => {
      const slug = file.name.replace(/\.md$/, '');
      return { ...Object.fromEntries(listing.item.map(field => {
        const value = entry.data[field];
        return [field, value instanceof Date ? value.toISOString().slice(0, 10) : value];
      })), slug, url: entryPath(collection.name, slug, locale) };
    });
  return { entries, count: entries.length, isEmpty: entries.length === 0 };
}
