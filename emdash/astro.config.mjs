import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import auditLog from "@emdash-cms/plugin-audit-log";
import { demoPlugin } from "@local/plugin-demo";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { google } from "emdash/auth/providers/google";
import { sqlite } from "emdash/db";

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
	},
	adapter: node({
		mode: "standalone",
	}),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			plugins: [auditLog, demoPlugin()],
			authProviders: [google()],
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
