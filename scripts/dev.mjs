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

// A port only counts as free if BOTH loopbacks can bind: Vite/Astro listen on
// ::1, so probing 127.0.0.1 alone reports "free" for ports they already hold
// (and the banner would then lie about where this project ends up).
function bindable(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function isFree(port) {
  return (await bindable(port, "127.0.0.1")) && (await bindable(port, "::1"));
}

async function findPort(start) {
  for (let p = start; p < start + 50; p++) {
    if (await isFree(p)) return p;
  }
  throw new Error(`No free port in ${start}–${start + 49}`);
}

const astroDefault = Number(process.env.PORT) || 4321;
const lanzaDefault = 5173;
const astroPort = await findPort(astroDefault);
const lanzaPort = await findPort(lanzaDefault);

// ── startup banner ───────────────────────────────────────────────────────────
// The whole point: the CHOSEN ports, unmissable. With several checkouts running
// at once (lanza, laperle-lanza, …) the defaults get taken and Astro/Vite roll
// ports silently — this says exactly where THIS project ended up.
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const cyan = (s) => c("36", s);
const green = (s) => c("32", s);
const yellow = (s) => c("33", s);

const rolled = (port, def) =>
  port === def ? green(`:${port}`) : `${yellow(`:${port}`)} ${dim(`(:${def} was busy)`)}`;

console.log(`
${cyan("  ██╗      █████╗ ███╗   ██╗███████╗ █████╗ ")}
${cyan("  ██║     ██╔══██╗████╗  ██║╚══███╔╝██╔══██╗")}
${cyan("  ██║     ███████║██╔██║ ██║  ███╔╝ ███████║")}
${cyan("  ██║     ██╔══██║██║╚██╗██║ ███╔╝  ██╔══██║")}
${cyan("  ███████╗██║  ██║██║ ╚████║███████╗██║  ██║")}
${cyan("  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝")}
  ${dim("git-powered CMS · project:")} ${bold(project)}

  ${bold("Site ")}  ${cyan(`http://localhost:${astroPort}/`)}        ${rolled(astroPort, astroDefault)}
  ${bold("Admin")}  ${cyan(`http://localhost:${lanzaPort}/admin/`)}  ${rolled(lanzaPort, lanzaDefault)}
`);

const children = [];
// Run a local node CLI under a custom argv0 (the process name). No shell needed —
// argv0 is a spawn option — which keeps this dash-safe (`exec -a` is a bashism).
function launch(label, name, entry, args, cwd) {
  console.log(dim(`→ ${label}  [${name}]`));
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
