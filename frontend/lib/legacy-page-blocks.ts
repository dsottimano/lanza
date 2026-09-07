// Read-only compatibility for tenant schemas that still declare the former page
// builder. Do not add this field to new schemas. Keep old content rendering until
// its owner migrates it to an ordinary preset with declared slots.
export type LegacyPageBlock =
  | { type: 'hero'; heading: string; subheading?: string; image?: string; ctaText?: string; ctaUrl?: string }
  | { type: 'text'; body: string }
  | { type: 'image'; image: string; alt?: string; caption?: string }
  | { type: 'gallery'; images: { image: string; alt?: string }[] }
  | { type: 'cta'; heading?: string; text?: string; buttonText: string; buttonUrl: string };

export function legacyPageBlocks(data: object): LegacyPageBlock[] {
  const blocks = (data as { blocks?: LegacyPageBlock[] }).blocks;
  return Array.isArray(blocks) ? blocks : [];
}
