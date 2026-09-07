#!/usr/bin/env node
// Refuse to build a site running code the publisher has marked unsafe.
//
// This replaces the fan-out. The broker used to hold a GitHub App key that could
// write every tenant repository, and it used it to force-bump anyone below the
// `critical` dist-tag - a fix that arrived without asking, on someone else's
// property. That key is deleted (docs/release-plan.md), so nothing can reach a
// tenant's repo any more, and the pressure has to come from the one place a tenant
// still passes through on the way to being live: their own build.
//
// The trade, stated plainly: slower, and the owner acts instead of us. A site below
// the floor keeps serving - Cloudflare holds the last successful deployment - but it
// cannot deploy anything new until the pin moves. That is deliberate. Taking a site
// down over a version would be worse than the version.
//
// FAILS OPEN on anything ambiguous. The registry being unreachable, a pin that is
// not a version, no `critical` tag published: all of those build normally. Only a
// definitive "this version is below the published floor" stops a build, because a
// check that guesses would eventually stop every build on a bad afternoon at npm.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PACKAGE_NAME = "lanza-site";
const REGISTRY = `https://registry.npmjs.org/${PACKAGE_NAME}`;
// Long enough for a cold registry, short enough that a hung request does not stall
// a build. On timeout we build.
const TIMEOUT_MS = 8000;

// Semver compare, numeric segments only. Anything non-numeric (a prerelease tag, a
// URL, `latest`) makes the comparison meaningless, so callers check `isVersion`
// first rather than letting this map junk to zero - the bug that once had file:
// pins and forks judged as "version 0", below every floor.
export function isVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * The decision, pure and testable. Returns null to build, or a message to refuse
 * with. `running` is the version of the package doing the building; `floor` is the
 * `critical` dist-tag, or null when there isn't one.
 */
export function refusalFor(running, floor) {
  if (!isVersion(running) || !isVersion(floor)) return null;
  if (compareVersions(running, floor) >= 0) return null;
  return (
    `lanza: this site builds from ${PACKAGE_NAME} ${running}, which is below the ` +
    `security floor of ${floor}.\n\n` +
    `  Your live site is untouched - Cloudflare keeps serving the last build - but\n` +
    `  nothing new can deploy until the version moves.\n\n` +
    `  To fix it, either:\n` +
    `    - open /admin, go to Software, and install the update; or\n` +
    `    - set "${PACKAGE_NAME}": "${floor}" in package.json and push.\n`
  );
}

async function criticalTag() {
  try {
    const res = await fetch(REGISTRY, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tag = data?.["dist-tags"]?.critical;
    return typeof tag === "string" ? tag : null;
  } catch {
    // Offline, npm down, DNS, timeout. Build.
    return null;
  }
}

// The version doing the building is this package's own - not the pin in the
// tenant's package.json. They are normally the same, but the pin is a SPECIFIER
// (a range, a tag, a URL) while this is always the resolved version, and the
// resolved one is what actually runs.
function runningVersion(pkgRoot) {
  try {
    return JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

export async function checkFloor(pkgRoot) {
  const running = runningVersion(pkgRoot);
  if (!isVersion(running)) return null;
  const floor = await criticalTag();
  return refusalFor(running, floor);
}

// Run directly: `node scripts/check-floor.mjs [pkgRoot]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
  const refusal = await checkFloor(root);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
}
