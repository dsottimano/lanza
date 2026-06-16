import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import auditLog from "@emdash-cms/plugin-audit-log";
import { demoPlugin } from "@local/plugin-demo";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

// Set DEPLOY_TARGET=cloudflare (the build:cf / deploy scripts do this) to build
// for Cloudflare Workers with D1 + R2 + Access + edge caching. Otherwise we run
// locally on Node with SQLite + filesystem storage and the dev-bypass login.
const isCf = process.env.DEPLOY_TARGET === "cloudflare";

// Cloudflare Access (admin auth). Non-secret identifiers from the Access app;
// pass at build time: CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD (see .env.example).
// When unset, no auth adapter is wired and the dev-bypass endpoint is used.
const accessTeamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
const accessAud = process.env.CF_ACCESS_AUD;

let adapter, database, storage, auth, cacheProvider;
if (isCf) {
	const cloudflare = (await import("@astrojs/cloudflare")).default;
	const { d1, r2, access, cloudflareCache } = await import("@emdash-cms/cloudflare");
	adapter = cloudflare();
	database = d1({ binding: "DB", session: "auto" });
	storage = r2({ binding: "MEDIA" });
	if (accessTeamDomain && accessAud) {
		auth = access({
			teamDomain: accessTeamDomain,
			audience: accessAud,
			autoProvision: true,
		});
	}
	// Edge-cache rendered public pages via the Workers Cache API. Pages call
	// Astro.cache.set(cacheHint); invalidation is purge-by-tag on publish
	// (reads CF_ZONE_ID var + CF_CACHE_PURGE_TOKEN secret).
	cacheProvider = cloudflareCache();
} else {
	const node = (await import("@astrojs/node")).default;
	adapter = node({ mode: "standalone" });
	database = sqlite({ url: "file:./data.db" });
	storage = local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" });
}

export default defineConfig({
	output: "server",
	// Dev-mode fix: the admin barrel-imports @phosphor-icons/react (~3000 icons).
	// Without pre-bundling, Vite serves each icon as its own module request
	// (~4600 requests / ~78MB per admin load). Force esbuild to pre-bundle it
	// into one tree-shaken chunk. (Prod builds already bundle this away.)
	vite: {
		plugins: [tailwindcss()],
		optimizeDeps: {
			include: ["@phosphor-icons/react"],
		},
		// Required under the Cloudflare adapter: dev runs through miniflare, which
		// persists D1/R2/KV to .wrangler/state on every request — Vite would watch
		// those *.sqlite-wal writes and fall into an endless reload loop. Harmless
		// on Node.
		server: {
			watch: {
				ignored: ["**/.wrangler/**", "**/data.db*", "**/dist/**"],
			},
		},
		// EmDash 0.19 splits its runtime across chunks such that the Cloudflare
		// build can evaluate the plugin-registration array before a const it
		// depends on initializes — a circular-import TDZ that 500s the Worker.
		// Collapsing emdash into one chunk removes the cross-chunk boundary.
		build: isCf
			? {
					rollupOptions: {
						output: {
							manualChunks(id) {
								if (id.includes("/emdash/") || id.includes("@emdash-cms/")) {
									return "emdash-runtime";
								}
							},
						},
					},
				}
			: undefined,
	},
	adapter,
	// Edge caching (Cloudflare only). routeRules turn caching ON per route and
	// supply maxAge/swr; pages add content Cache-Tags via Astro.cache.set so
	// publishing purges by tag. List every PUBLIC route here. NEVER add a
	// `/[...path]` catch-all rule — it would match /_emdash/* and cache the
	// admin. /search and 404 are intentionally omitted (never cached).
	...(cacheProvider
		? {
				experimental: {
					cache: { provider: cacheProvider },
					routeRules: {
						"/": { maxAge: 300, swr: 86400 },
						"/posts": { maxAge: 300, swr: 86400 },
						"/posts/[slug]": { maxAge: 300, swr: 86400 },
						"/category/[slug]": { maxAge: 300, swr: 86400 },
						"/tag/[slug]": { maxAge: 300, swr: 86400 },
						"/rss.xml": { maxAge: 3600, swr: 86400 },
						// Static pages served by the [...path] catch-all (pages
						// collection) — add each slug explicitly, e.g.:
						// "/about": { maxAge: 300, swr: 86400 },
					},
				},
			}
		: {}),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database,
			storage,
			plugins: [auditLog, demoPlugin()],
			...(auth ? { auth } : {}),
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-sans",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "Libre Caslon Text",
			cssVariable: "--font-serif",
			weights: [400, 700],
			fallbacks: ["Georgia", "serif"],
		},
		{
			provider: fontProviders.google(),
			name: "Hanken Grotesk",
			cssVariable: "--font-label",
			weights: [500, 600],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
