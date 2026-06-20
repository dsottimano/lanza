/**
 * Per-entry page-width / margin control.
 *
 * Any content type can opt in by adding the two standard fields to its
 * collection in `seed/seed.json` (copy the block below verbatim — that's how a
 * NEW content type inherits the control):
 *
 *   { "slug": "layout_width", "label": "Page width", "type": "select",
 *     "options": [
 *       { "value": "default", "label": "Default reading column" },
 *       { "value": "wide",    "label": "Wide" },
 *       { "value": "full",    "label": "Full screen" },
 *       { "value": "narrow",  "label": "Narrow" } ] },
 *   { "slug": "layout_padding", "label": "Custom side padding (%)",
 *     "type": "number" }
 *
 * Renderers call `resolveLayout(entry.data)` and spread the result onto the
 * article wrapper: a `data-width` attribute the scoped CSS keys off, plus an
 * optional `--page-pad-x` custom property for the custom-padding override.
 * No new DB queries, no core changes — the values ride along in the cached
 * render. Pattern-routed collections (`[...path].astro`) get this for free, so
 * future content types need only the two fields above.
 */
export type LayoutWidth = "default" | "wide" | "full" | "narrow";

const PRESETS = new Set<LayoutWidth>(["default", "wide", "full", "narrow"]);

// Side padding is per-side; clamp so an editor can't enter 90% and collapse the
// column to nothing.
const MAX_PAD_PERCENT = 45;

export interface ResolvedLayout {
	/** Value for the `data-width` attribute the scoped CSS targets. */
	"data-width": LayoutWidth;
	/** Inline style carrying the custom side padding, or undefined. */
	style?: string;
}

export function resolveLayout(data: Record<string, unknown>): ResolvedLayout {
	const raw = Number(data.layout_padding);
	const hasCustomPad = Number.isFinite(raw) && raw > 0;

	// A custom side padding implies an edge-to-edge column inset by that padding
	// — i.e. the "20% margin" case — so it overrides the preset to "full".
	if (hasCustomPad) {
		const pad = Math.min(raw, MAX_PAD_PERCENT);
		return { "data-width": "full", style: `--page-pad-x: ${pad}%` };
	}

	const preset = data.layout_width;
	const width: LayoutWidth =
		typeof preset === "string" && PRESETS.has(preset as LayoutWidth)
			? (preset as LayoutWidth)
			: "default";

	return { "data-width": width };
}
