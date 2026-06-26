// Compiles the CMS-editable src/data/redirects.json into Cloudflare's native
// public/_redirects file. Runs before `astro build`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dataPath = fileURLToPath(new URL("../src/data/redirects.json", import.meta.url));
const outPath = fileURLToPath(new URL("../public/_redirects", import.meta.url));

const { redirects = [] } = JSON.parse(readFileSync(dataPath, "utf8"));
const lines = redirects
  .filter((r) => r && r.from && r.to)
  .map((r) => `${r.from} ${r.to} ${r.status ?? 301}`);

writeFileSync(outPath, lines.length ? lines.join("\n") + "\n" : "");
console.log(`gen-redirects: wrote ${lines.length} rule(s) to public/_redirects`);
