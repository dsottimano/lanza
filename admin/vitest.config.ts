import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Minimal config for component/unit tests — just the Vue plugin + a DOM. The main
// vite.config.ts carries the dev GitHub/Cloudflare proxies (which import Pages
// Function code), none of which the tests need, so tests get their own config.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
