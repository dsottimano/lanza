// First-party capabilities only. Configuration never names executable URLs or paths.
export const SITE_PLUGINS = [
  { id: 'readingProgress', name: 'Reading progress', description: 'A slim bar shows how far a reader has moved through an article.', scope: 'Posts, rich-text pages and starter detail pages.' },
  { id: 'imageZoom', name: 'Image zoom', description: 'Open unlinked article and gallery images in a larger, keyboard-accessible view.', scope: 'Article images and starter galleries. Existing image links keep their behavior.' },
] as const;
export type SitePluginId = typeof SITE_PLUGINS[number]['id'];
export type SitePlugins = Record<SitePluginId, boolean>;
export function resolveSitePlugins(raw: unknown): SitePlugins {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { readingProgress: value.readingProgress === true, imageZoom: value.imageZoom === true };
}
