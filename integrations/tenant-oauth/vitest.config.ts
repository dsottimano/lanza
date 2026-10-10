import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: { bindings: {
      OAUTH_ORIGIN: "https://oauth.example.com",
      SITE_ORIGIN: "https://site.example.com",
    } },
  })],
  test: { include: ["src/**/*.test.ts"] },
});
