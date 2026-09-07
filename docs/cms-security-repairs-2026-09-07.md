# CMS security and recovery repairs — September 7, 2026

Local repairs following the two September 7 reviews. Both remote branches were
fetched before editing and matched `4279d67`. The original reports and existing
local work were preserved. No remote writes, publishing or deployment occurred.

## Repaired

- Editor Git-data ref updates now validate the complete proposed tree and its
  single parent against the current draft. Missing base trees, reused trees,
  owner-file deletions, executable files, symlinks and submodules cannot bypass
  the boundary. Incomplete verification refuses the update. Editor writes are
  limited to Markdown content and supported raster upload extensions.
- Editor force updates are refused. A missing role is read-only. Development
  invokes the production proxy handler using the token's actual repository role.
- JSON and text saves no longer retry stale payloads with another writer's SHA.
- Theme installation and rollback pin the reviewed draft commit and refuse later
  changes. Final ref updates are non-force, including races after preflight.
- Discard checks both reviewed branch heads and restores the reviewed production
  tree in a new commit retaining both histories. The confirmation explains this;
  Refresh review lets the owner inspect newer changes before retrying.
- Appearance load failures disable Save and offer Retry loading, preventing
  default values from replacing an existing design after a failed read.

## Verification

- 366 Functions/script tests and 420 CMS tests passed.
- `npm run check:site`: no errors or warnings.
- Admin typecheck/build and `node bin/lanza.mjs build` passed.
- Cloudflare's required Wrangler 3.114.17 Functions bundle passed in both this
  checkout and a disposable tenant installed from the newly packed tarball.
  The tenant site build also passed. The fixture needed its normal tenant-owned
  `lanza.config.json` before Functions could compile.
- Browser checks against both Vite and rebuilt static assets passed: a synthetic
  page's Heading field updated its sandboxed preview; appearance Save stayed
  disabled after a failed read and recovered after Retry. No browser errors or
  attempted writes. Actual development-proxy GitHub identity and content reads
  returned 200.
- A disposable local Git repository exercised theme packing, parsing, installation,
  public rendering, an edited CMS slot, and rollback. Rollback restored the exact
  original tree. A stale rollback refused a concurrent owner edit; a freshly
  reviewed rollback then succeeded. The synthetic page was at
  Pages → English → review-studio, using its declared review-studio preset fields;
  it was never added to this repository or published.

Public builds retain existing empty posts/tags/categories/authors warnings.
Authenticated production Cloudflare connectivity and deployed mutation behavior
remain unverified. Successful local bundles are not evidence of deployment.

## Still open

The other findings in the original reviews remain queued, including mobile layout,
Cloudflare production-status selection, custom-route URL helpers, error-dialog
accessibility, recipe overwrite/partial-apply behavior and session-refresh races.
Binary upload replacement still uses its separate existing 422/name-collision
flow; the no-retry repair above covers JSON/text saves. Large GitHub compare/commit
file-list limits also need a separate completeness review. Additional themes,
agent plugins and Meta sharing were not implemented in this repair pass.
