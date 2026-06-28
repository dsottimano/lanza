// `npm run dev` launcher: starts BOTH dev servers — the Astro site and the Lanza
// CMS — each on a free port (so a busy default never blocks or collides). Astro
// and Vite also auto-roll ports themselves, so this is belt-and-suspenders.
//
// Lanza is launched via `npm --prefix lanza run dev` so Vite resolves from
// lanza/node_modules — never a hardcoded path that can ENOENT.
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url).pathname;

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
function launch(label, cmd, opts) {
  console.log(`→ ${label}`);
  const child = spawn(cmd, { stdio: "inherit", shell: true, ...opts });
  child.on("error", (e) => console.error(`  [${label}] failed: ${e.message}`));
  children.push(child);
  return child;
}

// Astro site — call the local binary so we don't pick up any global shim/daemon.
launch(
  `Astro site   http://localhost:${astroPort}/`,
  `"${here("../node_modules/.bin/astro")}" dev --port ${astroPort}`,
  { cwd: here("../") },
);

// Lanza CMS — only if its deps are installed; via npm so Vite resolves locally.
if (existsSync(here("../lanza/node_modules"))) {
  launch(
    `Lanza CMS    http://localhost:${lanzaPort}/admin/`,
    `npm run dev -- --port ${lanzaPort}`,
    { cwd: here("../lanza/") },
  );
} else {
  console.warn(
    "⚠  Lanza CMS skipped — its deps aren't installed.\n" +
      "   Run:  npm --prefix lanza install   then re-run npm run dev.",
  );
}

function shutdown() {
  for (const c of children) c.kill("SIGINT");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
