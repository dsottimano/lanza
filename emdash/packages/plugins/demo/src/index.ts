import type { PluginDescriptor } from "emdash";

/**
 * Demo plugin descriptor — runs in Vite at build time (imported by astro.config.mjs).
 * Must be side-effect-free: just metadata.
 *
 * Demonstrates the two halves of plugin power:
 *   - DB:  its own `notes` storage collection (auto-created, no migrations) +
 *          reads real CMS content via the `content:read` capability +
 *          writes a note on every content save (content:afterSave hook).
 *   - UI:  a Block Kit admin page at /demo (form + stats + table).
 */
export function demoPlugin(): PluginDescriptor {
	return {
		id: "demo",
		version: "1.0.0",
		format: "standard",
		entrypoint: "@local/plugin-demo/sandbox",
		options: {},
		// Advisory on node/trusted; enforced when sandboxed on Cloudflare.
		capabilities: ["content:read"],
		// Plugin-private document collection. EmDash creates the schema for us.
		storage: {
			notes: {
				indexes: ["createdAt"],
			},
		},
		// Registers a sidebar admin page rendered by the `admin` Block Kit route.
		adminPages: [{ path: "/demo", label: "Demo", icon: "sparkles" }],
	};
}
