// `npm run dev` launcher: starts BOTH dev servers — the Astro site and the Lanza
// CMS — each on a free port (so a busy default never blocks or collides). Astro
// and Vite also auto-roll ports themselves, so this is belt-and-suspenders.
//
// Each server runs under a recognisable process name (argv0) derived from the
// repo folder: `<folder>-frontend` (Astro) and `<folder>-admin` (Vite/CMS) —
// e.g. lanza-frontend / lanza-admin. So a running server is found without
// guessing the auto-rolled port:
//   pgrep -af lanza-admin                          # is it running?
//   lsof -Pan -p <pid> -iTCP -sTCP:LISTEN          # which port?
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename } from "node:path";

const here = (p) => new URL(p, import.meta.url).pathname;

// Process-name prefix = the repo folder name (lanza, laperle-lanza, …), so
// checkouts never collide in `pgrep`.
const project = basename(here("../").replace(/\/+$/, ""));

function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function findPort(start) {
  for (let p = start; p < start + 50; p++) {
    if (await isFree(p)) return p;
  }
  throw new Error(`No free port in ${start}–${start + 49}`);
}

const astroPort = await findPort(Number(process.env.PORT) || 4321);
const lanzaPort = await findPort(5173);

const children = [];
// Run a local node CLI under a custom argv0 (the process name). No shell needed —
// argv0 is a spawn option — which keeps this dash-safe (`exec -a` is a bashism).
function launch(label, name, entry, args, cwd) {
  console.log(`→ ${label}  [${name}]`);
  const child = spawn(process.execPath, [entry, ...args], {
    argv0: name,
    stdio: "inherit",
    cwd,
  });
  child.on("error", (e) => console.error(`  [${label}] failed: ${e.message}`));
  children.push(child);
  return child;
}

// Astro site — resolve the real bin entry so node runs it directly under our name.
launch(
  `Astro site   http://localhost:${astroPort}/`,
  `${project}-frontend`,
  realpathSync(here("../node_modules/.bin/astro")),
  ["dev", "--port", String(astroPort)],
  here("../"),
);

// Lanza CMS — only if its deps are installed; run Vite from admin/ so it resolves
// its own config and node_modules.
if (existsSync(here("../admin/node_modules"))) {
  launch(
    `Lanza CMS    http://localhost:${lanzaPort}/admin/`,
    `${project}-admin`,
    realpathSync(here("../admin/node_modules/.bin/vite")),
    ["--port", String(lanzaPort)],
    here("../admin/"),
  );
} else {
  console.warn(
    "⚠  Lanza CMS skipped — its deps aren't installed.\n" +
      "   Run:  npm --prefix admin install   then re-run npm run dev.",
  );
}

function shutdown() {
  for (const c of children) c.kill("SIGINT");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
