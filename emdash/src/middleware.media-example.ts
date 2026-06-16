/**
 * EXAMPLE — public media URL rewrite for Cloudflare + R2.
 *
 * Rename to `src/middleware.ts` to activate (Astro only auto-loads that name).
 * See PRODUCTION.md §4 for why this exists.
 *
 * EmDash core hardcodes content image URLs as `/_emdash/api/media/file/<key>`,
 * which lives under `/_emdash` (Access-gated) and costs a Worker+R2 read per
 * request. This streams the rendered HTML through HTMLRewriter and swaps those
 * URLs to a public R2 custom domain (MEDIA_PUBLIC_BASE, e.g.
 * https://media.example.com) so images are CDN-cached and not Access-gated.
 *
 * Project-level (not a core patch) so it survives EmDash upgrades. No-ops when
 * MEDIA_PUBLIC_BASE is unset or HTMLRewriter is unavailable (Node dev).
 */
import { defineMiddleware } from "astro:middleware";

interface RewriterElement {
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
}
interface ElementHandler {
	element(el: RewriterElement): void;
}
interface HTMLRewriterInstance {
	on(selector: string, handler: ElementHandler): HTMLRewriterInstance;
	transform(response: Response): Response;
}
declare const HTMLRewriter: { new (): HTMLRewriterInstance };

const MARKER = "/_emdash/api/media/file/";

export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();

	const base = (
		context.locals as { runtime?: { env?: Record<string, string> } }
	).runtime?.env?.MEDIA_PUBLIC_BASE;
	if (!base) return response;

	if (context.url.pathname.startsWith("/_emdash")) return response;
	if (!(response.headers.get("content-type") || "").includes("text/html")) {
		return response;
	}
	if (typeof HTMLRewriter === "undefined") return response;

	const publicBase = base.replace(/\/+$/, "");

	const swap = (value: string | null): string | null => {
		if (!value) return null;
		const i = value.indexOf(MARKER);
		if (i === -1) return null;
		return `${publicBase}/${value.slice(i + MARKER.length)}`;
	};

	const swapSrcset = (value: string | null): string | null => {
		if (!value || !value.includes(MARKER)) return null;
		return value
			.split(",")
			.map((part) => {
				const seg = part.trim();
				const sp = seg.indexOf(" ");
				const url = sp === -1 ? seg : seg.slice(0, sp);
				const desc = sp === -1 ? "" : seg.slice(sp);
				const next = swap(url);
				return next ? `${next}${desc}` : seg;
			})
			.join(", ");
	};

	const rewriteAttr = (
		el: RewriterElement,
		attr: string,
		fn: (v: string | null) => string | null,
	) => {
		const next = fn(el.getAttribute(attr));
		if (next) el.setAttribute(attr, next);
	};

	return new HTMLRewriter()
		.on("img", {
			element(el) {
				rewriteAttr(el, "src", swap);
				rewriteAttr(el, "srcset", swapSrcset);
			},
		})
		.on("source", {
			element(el) {
				rewriteAttr(el, "src", swap);
				rewriteAttr(el, "srcset", swapSrcset);
			},
		})
		.on("meta", {
			element(el) {
				rewriteAttr(el, "content", swap);
			},
		})
		.on("link", {
			element(el) {
				rewriteAttr(el, "href", swap);
			},
		})
		.transform(response);
});
