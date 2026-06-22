import { defineMiddleware, sequence } from "astro:middleware";
import { handleContentAuthors } from "emdash";

/**
 * Re-provide the `handleContentAuthors` runtime handler (hook, not a core patch).
 *
 * Why: EmDash 0.19's auth middleware builds `locals.emdash` with ~50 bound
 * runtime handlers but forgets to bind `handleContentAuthors`. The admin
 * author-filter dropdown GETs `/_emdash/api/content/:collection/authors`, whose
 * route does `if (!emdash?.handleContentAuthors) return 500 "EmDash is not
 * initialized"` — so the dropdown 500s. (Confirmed against 0.19's
 * `dist/astro/middleware.mjs`; the handler IS a public `emdash` export and the
 * runtime method is just `handleContentAuthors(this.db, collection)`.)
 *
 * Fix (Rule 5 — no core edit, replaces the old `patches/emdash@0.19.0.patch`):
 * EmDash injects its middleware with `order: "pre"`, so it has already populated
 * `locals.emdash` (including `.db`, the same Kysely instance the runtime method
 * uses) by the time this runs. We graft the missing handler on, reconstructing
 * it exactly. Idempotent and self-disabling: only fills when ABSENT, so a future
 * EmDash release that binds it itself silently takes over.
 */
const restoreContentAuthors = defineMiddleware(async (context, next) => {
	const emdash = (
		context.locals as {
			emdash?: {
				db?: unknown;
				handleContentAuthors?: (collection: string) => unknown;
			};
		}
	).emdash;

	if (emdash?.db && emdash.handleContentAuthors === undefined) {
		emdash.handleContentAuthors = (collection: string) =>
			handleContentAuthors(emdash.db as never, collection);
	}

	return next();
});

/**
 * Coalesce inline visual-editor autosaves into a single draft revision and
 * backfill the revision author.
 *
 * Why: emdash's inline visual-editing toolbar PUTs `{ data: {...} }` to
 * `/_emdash/api/content/:collection/:id` on every field-blur, omitting
 * `skipRevision`. Core therefore inserts a brand-new revision row per blur,
 * so one editing session balloons into dozens of revisions, none attributed
 * to a user. The full admin editor avoids this by sending `skipRevision: true`
 * on autosave.
 *
 * Fix (no core changes): default the absent flag to `true` so inline saves
 * update the existing draft revision in place, and backfill `authorId` from
 * the session. Because we only fill when the key is ABSENT, the admin
 * editor's explicit choice is never overridden, and it self-disables if a
 * future emdash release starts sending the flag itself.
 */
const CONTENT_ITEM_PUT = /^\/_emdash\/api\/content\/[^/]+\/[^/]+$/;

const autosaveCoalesce = defineMiddleware(async (context, next) => {
	const { request, locals } = context;

	if (
		request.method === "PUT" &&
		CONTENT_ITEM_PUT.test(new URL(request.url).pathname)
	) {
		try {
			const body = await request.clone().json();

			if (body && typeof body === "object") {
				let changed = false;
				if (body.skipRevision === undefined) {
					body.skipRevision = true;
					changed = true;
				}
				const userId = (locals as { user?: { id?: string } }).user?.id;
				if (body.authorId === undefined && userId) {
					body.authorId = userId;
					changed = true;
				}

				if (changed) {
					context.request = new Request(request.url, {
						method: request.method,
						headers: request.headers,
						body: JSON.stringify(body),
					});
				}
			}
		} catch {
			// Non-JSON or unreadable body: leave the request untouched.
		}
	}

	return next();
});

/**
 * Public media URL rewrite (Cloudflare + R2).
 *
 * EmDash core hardcodes content image URLs as `/_emdash/api/media/file/<key>`,
 * which lives under `/_emdash` (Cloudflare-Access-gated) and costs a Worker+R2
 * read per request. We stream the rendered HTML through HTMLRewriter and swap
 * those URLs to a public R2 custom domain (MEDIA_PUBLIC_BASE, e.g.
 * https://media.example.com) so images are CDN-cached and not Access-gated.
 *
 * Project-level (not a core patch) so it survives EmDash upgrades. No-ops when
 * MEDIA_PUBLIC_BASE is unset or HTMLRewriter is unavailable (Node dev). See
 * PRODUCTION.md §4.
 */
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

const mediaRewrite = defineMiddleware(async (context, next) => {
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
				// Defer the emdash runtime stylesheet on public pages: it's mostly
				// admin/widget CSS the public above-the-fold render doesn't need, but
				// Astro injects it as a render-blocking <link>. Load it non-blocking
				// (print media + onload swap). The site's own CSS stays blocking, and
				// admin (/_emdash) never reaches this rewriter, so its CSS is intact.
				const rel = el.getAttribute("rel");
				const href = el.getAttribute("href");
				if (
					rel === "stylesheet" &&
					href &&
					href.includes("emdash-runtime") &&
					href.endsWith(".css")
				) {
					el.setAttribute("media", "print");
					el.setAttribute("onload", "this.media='all'");
					return;
				}
				rewriteAttr(el, "href", swap);
			},
		})
		.transform(response);
});

export const onRequest = sequence(
	restoreContentAuthors,
	autosaveCoalesce,
	mediaRewrite,
);
