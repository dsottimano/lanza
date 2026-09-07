# Local red-team security review — 2026-09-06

Scope: the current working tree, including existing uncommitted starter, writing
and public-site changes. Reviewed theme import/export, starter destination and
snapshot checks, MCP transport and tool confinement, admin authorization and proxy
boundaries, preview isolation and sanitization. Dependency audits cover the root,
admin and bot lockfiles. This is a local code/test review, not a production
penetration test or an audit of deployed Cloudflare/GitHub account configuration.

## Findings and remediation

| Finding | Assessment | Resolution |
|---|---|---|
| Theme gzip was fully decompressed before any limit | Medium: a crafted upload could exhaust the browser tab's memory before preview | Stop streaming decompression at 64 MiB; reject compressed uploads over 20 MiB before reading them; cap regular-file entries at 5,000 |
| Theme parser accepted duplicate paths, malformed octal sizes, truncated entries and ambiguous path segments; unsupported records were silently skipped | Low: ambiguous review/apply input and malformed bundle acceptance; no new protected-path bypass demonstrated | Reject duplicates including aliased manifests, invalid sizes, truncated data, links/PAX metadata, percent/control characters and dot/empty path segments |
| MCP buffered arbitrary request JSON before checking batch size | Medium: an authenticated owner token could exhaust Worker memory; no unauthenticated bypass demonstrated | Stream and count bytes, reject over 2 MiB with 413 even without Content-Length; reject empty batches |
| Dependency advisories in all three lockfiles | Root: 4 high/1 moderate; admin: 2 high/33 moderate; bot: 4 high. These are npm's affected-package counts, not independently reproduced exploits | Upgrade affected transitive packages, root js-yaml to 4.3.2, all direct Tiptap packages to 3.31.3, bot Wrangler to 4.129.0 with compatible Workers types. Final audit: zero reported vulnerabilities in all three trees |
| Theme UI/docs claimed apply or revert immediately went live; bundle trust was inadequately explained | Review risk: owners could misunderstand both publication and execution timing | Explain staging, separate Publish, all-pending-change review, and that trusted theme code executes during a staging build |
| README still described retired broker signing/minting and ADMIN_LOGIN authorization | Misleading security/setup guidance | Replace with current Device Flow, GitHub repository roles and user-token proxy model |

Regression tests exercise real gzip/tar payloads, memory limits, duplicate entries,
malformed manifests, path rejection and no-commit behavior. MCP transport tests
exercise streamed overflow/cancellation, declared size rejection before upstream
calls, batch handling, normal requests and editor denial before a publish tool call.
Existing adversarial tests cover proxy traversal, branch confinement, template
safety, render escaping, role checks and starter conflict handling.

The final browser check also found both shipped archives used obsolete
`frontend/data/` destinations rejected by the existing importer. Repacked their
data entries under `data/`, preserving file contents, and added import regression
tests for both bundles. They remain historical design snapshots.

## Remaining boundaries

- Themes intentionally include executable frontend/build code. The importer is a
  path allowlist, not a sandbox or provenance verifier. A malicious trusted theme
  can act during staging builds, before Publish. Do not describe these fixes as
  making arbitrary third-party bundles safe.
- MCP still accepts browser Origins without an allowlist and uses wildcard CORS.
  Bearer authentication remains mandatory; this is an existing accepted risk in
  [the security model](security-model.md), not resolved by the body limit.
- MCP credentials are owner credentials and can call GitHub directly. Tool
  confinement limits a steered agent's tool use, not a stolen credential's powers.
- A batch is limited by message count, not by aggregate GitHub subrequests. Some
  expensive authenticated batches can still exhaust the runtime budget. Tools
  already report bounded validation coverage; do not claim a whole-site check if
  folders were skipped.
- Remote resources/forms in templates and the public site's incomplete CSP remain
  accepted risks. Preview frames omit `allow-scripts`; template/render defenses
  and public body sanitization remain in place.
- Archive limits bound parser allocations, but are not a proof against every
  browser resource-exhaustion technique. PAX bundles must be repacked as ustar.
- No production requests, credential revocation, deployments, repository writes
  through MCP, or destructive attacks were performed. A targeted tracked-file
  scan for GitHub tokens and private-key headers returned no matches; it is not a
  complete secret-history scan. Broker onboarding was not exhaustively retested.

## Verification

- `npm test`: 328 functions/script tests and 363 CMS tests passed (691 total).
- `npm run check`: zero errors/warnings; existing informational hints remain.
- `npm run check:site`: zero errors/warnings.
- `npm run build`: CMS typecheck/build and 15 static pages succeeded. The existing
  empty Posts collection notice remains.
- `npx wrangler@3.114.17 pages functions build --outdir /tmp/lanza-fnbuild`: passed.
- Bot TypeScript check and Wrangler deployment dry-run: passed.
- Root, admin and bot `npm audit`: zero reported vulnerabilities after updates.
- Chrome at 1440px and 390px: English/Spanish How it works and Agents guides load
  with no horizontal overflow or page errors. Static `site-system.json` includes
  the theme contract. Built CMS imports Ocean into its review preview with the
  staging action and trust notice visible; GitHub API responses were mocked and no
  writes occurred.

Review consulted the current [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
for bounded request processing and [Tiptap's published advisory](https://github.com/advisories/GHSA-cp6q-959q-f8rh)
plus the registry audit responses for dependency remediation. Passing checks establish
these local results; they do not prove the absence of other vulnerabilities.
