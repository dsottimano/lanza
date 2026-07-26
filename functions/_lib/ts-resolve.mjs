// Test-only ESM resolver hook: lets node's native TypeScript runner resolve the
// EXTENSIONLESS relative imports the Functions source uses (e.g. `./lanza-content`),
// which the Cloudflare/esbuild bundler and tsc (moduleResolution: bundler) resolve
// natively but node ESM does not. Used only when running the *.test.mjs files:
//   node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs <test>
// Touches no source and no tsconfig.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    try {
      const p = fileURLToPath(new URL(specifier, context.parentURL)) + ".ts";
      if (existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
    } catch {
      /* fall through to default resolution */
    }
  }
  return next(specifier, context);
}

// Node ESM demands `with { type: "json" }` on a JSON import; the Cloudflare/esbuild
// bundler does not, and the Functions source is written for the bundler (e.g.
// `import repo from "../../lanza.config.json"` in _middleware.ts). Supplying the
// attribute here lets a test import a REAL Function module end to end — which is
// what makes "the gate refused AND next() was never called" testable.
export async function load(url, context, next) {
  if (url.endsWith(".json")) {
    return next(url, { ...context, importAttributes: { type: "json" } });
  }
  return next(url, context);
}
