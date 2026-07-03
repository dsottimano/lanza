import { defineConfig, loadEnv, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
// Shared proxy policy — same modules the prod Pages Functions use, so the
// allowlists and CSRF checks can't drift between dev and prod.
import { crossOriginBlocked, isAllowed } from "../functions/_lib/gh-proxy";
import {
  isAllowed as cfIsAllowed,
  resolveProject as cfResolveProject,
  substituteAccount as cfSubstituteAccount,
} from "../functions/_lib/cf-proxy";

// Dev mirror of the production Pages Function (functions/admin/api/gh/[[path]].ts).
// Intercepts /admin/api/gh/* in the Vite dev server and proxies to GitHub with
// the token injected server-side, so the SPA never holds a token in dev either.
// The token comes from admin/.env (GITHUB_TOKEN, NON-VITE-prefixed → never
// bundled, never reaches the client). Same client code runs in dev and prod.
function githubProxyDev(token: string | undefined): Plugin {
  return {
    name: "lanza-github-proxy-dev",
    configureServer(server) {
      // connect strips the mount prefix, so `req.url` is the path *after*
      // /admin/api/gh — exactly what we append to api.github.com.
      server.middlewares.use("/admin/api/gh", async (req, res) => {
        // Cast to minimal shapes — @types/node isn't installed, so the connect
        // IncomingMessage/ServerResponse types don't expose these members here.
        const r = req as unknown as {
          url?: string;
          method?: string;
          headers: Record<string, string | undefined>;
        };
        const w = res as unknown as {
          statusCode: number;
          setHeader(name: string, value: string): void;
          end(chunk?: string): void;
        };

        const reject = (status: number, message: string) => {
          w.statusCode = status;
          w.setHeader("content-type", "application/json");
          w.end(JSON.stringify({ message }));
        };

        try {
          const method = r.method ?? "GET";
          const subPath = r.url ?? "";

          // Same allowlist + CSRF check as prod (functions/_lib/gh-proxy.ts).
          if (!isAllowed(method, subPath)) {
            reject(
              403,
              `Blocked by proxy allowlist: ${method} ${subPath} is not a permitted GitHub endpoint.`,
            );
            return;
          }
          if (crossOriginBlocked(method, r.headers["origin"] ?? null, r.headers["host"] ?? null)) {
            reject(403, "Cross-origin write rejected.");
            return;
          }

          if (!token) {
            w.statusCode = 500;
            w.setHeader("content-type", "application/json");
            w.end(
              JSON.stringify({
                message:
                  "Dev GitHub proxy: GITHUB_TOKEN is missing from admin/.env (copy .sample.env).",
              }),
            );
            return;
          }

          const target = `https://api.github.com${r.url ?? ""}`;

          let body = "";
          if (r.method !== "GET" && r.method !== "HEAD") {
            for await (const chunk of req as AsyncIterable<unknown>)
              body += String(chunk);
          }

          const upstream = await fetch(target, {
            method: r.method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: r.headers["accept"] ?? "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "lanza-cms-dev",
              ...(r.headers["content-type"]
                ? { "Content-Type": r.headers["content-type"] }
                : {}),
            },
            body: body || undefined,
          });

          w.statusCode = upstream.status;
          const ct = upstream.headers.get("content-type");
          if (ct) w.setHeader("content-type", ct);
          w.end(await upstream.text());
        } catch (e) {
          w.statusCode = 502;
          w.setHeader("content-type", "application/json");
          w.end(
            JSON.stringify({
              message: `Dev GitHub proxy error: ${(e as Error).message}`,
            }),
          );
        }
      });
    },
  };
}

// Dev mirror of the production Pages Function (functions/admin/api/cf/[[path]].ts).
// Intercepts /admin/api/cf/* in the Vite dev server and proxies to the Cloudflare
// API with the token injected server-side. All three values come from admin/.env
// (NON-VITE-prefixed → never bundled): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
// PAGES_PROJECT. Same client code, same 503 "not configured" shape, as prod.
function cloudflareProxyDev(cfg: {
  token: string | undefined;
  accountId: string | undefined;
  project: string | undefined;
}): Plugin {
  return {
    name: "lanza-cloudflare-proxy-dev",
    configureServer(server) {
      // connect strips the mount prefix, so `req.url` is the path *after*
      // /admin/api/cf — exactly what we append to api.cloudflare.com/client/v4.
      server.middlewares.use("/admin/api/cf", async (req, res) => {
        // Cast to minimal shapes — @types/node isn't installed, so the connect
        // IncomingMessage/ServerResponse types don't expose these members here.
        const r = req as unknown as {
          url?: string;
          method?: string;
          headers: Record<string, string | undefined>;
        };
        const w = res as unknown as {
          statusCode: number;
          setHeader(name: string, value: string): void;
          end(chunk?: string): void;
        };

        const send = (status: number, body: unknown) => {
          w.statusCode = status;
          w.setHeader("content-type", "application/json");
          w.end(JSON.stringify(body));
        };

        try {
          const missing: string[] = [];
          if (!cfg.token) missing.push("CLOUDFLARE_API_TOKEN");
          if (!cfg.accountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
          if (!cfg.project) missing.push("PAGES_PROJECT");
          if (missing.length) {
            // Same machine-readable shape prod returns, so the UI's "not
            // configured" state works identically in dev.
            send(503, {
              configured: false,
              missing,
              message:
                "Dev Cloudflare proxy: missing from admin/.env (copy .sample.env).",
            });
            return;
          }
          const accountId = cfg.accountId as string;
          const project = cfg.project as string;

          const method = r.method ?? "GET";
          const subPath = r.url ?? "";

          // Resolve the project placeholder, then run the same allowlist + CSRF
          // check as prod (functions/_lib/cf-proxy.ts).
          const resolved = cfResolveProject(subPath, project);
          if (!cfIsAllowed(method, resolved, project)) {
            send(
              403,
              `Blocked by proxy allowlist: ${method} ${subPath} is not a permitted Cloudflare endpoint.`,
            );
            return;
          }
          if (crossOriginBlocked(method, r.headers["origin"] ?? null, r.headers["host"] ?? null)) {
            send(403, { message: "Cross-origin write rejected." });
            return;
          }

          const target = `https://api.cloudflare.com/client/v4/${cfSubstituteAccount(resolved, accountId)}`;

          let body = "";
          if (r.method !== "GET" && r.method !== "HEAD") {
            for await (const chunk of req as AsyncIterable<unknown>)
              body += String(chunk);
          }

          const upstream = await fetch(target, {
            method: r.method,
            headers: {
              Authorization: `Bearer ${cfg.token}`,
              Accept: r.headers["accept"] ?? "application/json",
              ...(r.headers["content-type"]
                ? { "Content-Type": r.headers["content-type"] }
                : {}),
            },
            body: body || undefined,
          });

          w.statusCode = upstream.status;
          const ct = upstream.headers.get("content-type");
          if (ct) w.setHeader("content-type", ct);
          w.end(await upstream.text());
        } catch (e) {
          send(502, {
            message: `Dev Cloudflare proxy error: ${(e as Error).message}`,
          });
        }
      });
    },
  };
}

// Dev mirror of the prod auth gate (functions/admin/_middleware.ts + the OAuth
// endpoints under functions/admin/api/auth/). Those Pages Functions never run
// under Vite, so localhost is already gate-free — but a built SPA served in dev
// could still probe /admin/api/auth/*. This plugin makes that surface a no-op:
// every auth endpoint just bounces to /admin/, so dev behaves as "always signed
// in", exactly as it did under Cloudflare Access (localhost was never gated).
function authBypassDev(): Plugin {
  return {
    name: "lanza-auth-bypass-dev",
    configureServer(server) {
      server.middlewares.use("/admin/api/auth", (_req, res) => {
        const w = res as unknown as {
          statusCode: number;
          setHeader(name: string, value: string): void;
          end(chunk?: string): void;
        };
        w.statusCode = 302;
        w.setHeader("Location", "/admin/");
        w.end();
      });
    },
  };
}

// Lanza CMS — the admin app. Builds to ../public/admin/ (replacing Sveltia),
// served as a static SPA by Astro/Pages at /admin/. The output is gitignored and
// regenerated by the deploy build (see the root `build` script).
export default defineConfig(({ mode }) => {
  // Prefix "" loads ALL vars (incl. non-VITE GITHUB_TOKEN) for config-time use
  // only — loadEnv does not expose them to the client bundle.
  const env = loadEnv(mode, ".", "");

  return {
    base: "/admin/",
    plugins: [
      vue(),
      tailwindcss(),
      authBypassDev(),
      githubProxyDev(env.GITHUB_TOKEN),
      cloudflareProxyDev({
        token: env.CLOUDFLARE_API_TOKEN,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        project: env.PAGES_PROJECT,
      }),
    ],
    // Dev server serves the SPA under the `/admin/` base. `open` lands the browser
    // on the working URL (the bare root 404s because of the base). Vite picks the
    // next free port automatically if 5173 is taken (strictPort defaults false).
    server: {
      open: "/admin/",
    },
    build: {
      outDir: "../public/admin",
      emptyOutDir: true,
    },
  };
});
