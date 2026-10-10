# Admin production review — October 10, 2026

Scope: the existing CMS, with the approved collection-screen redesign and selected
reliability/security repairs. Starting commit: `2fbd18d`. Main and staging were
fetched and inspected before edits and before preparing the push. The checkout
started clean. Public content and templates were preserved.

## Implemented

- Admin-only neutral colors, slate-blue actions, readable language controls,
  larger control targets and visible keyboard focus. Fixed the unlayered anchor
  color that overrode primary buttons and language links.
- Collection lists now have a clear heading, filename search, visible Edit and
  staging Preview actions, counts, and empty/error/search states. Search stays
  local to the already loaded filenames and makes no per-entry API requests.
- Shared mobile navigation replaces the desktop rail on narrow screens. Selecting
  a destination or pressing Escape closes it; navigation restores toggle focus.
- Collection requests ignore stale results/errors after another load or unmount.
  Locale and folder changes are also observed by the component itself.
- The global error overlay is now a native modal dialog with a name, description,
  initial focus, Escape dismissal and native focus confinement/restoration.
- Site Health requests production deployments and verifies their environment.
  Only a successful **deploy** stage counts as live; a completed build does not.
- Raw-text loading refuses GitHub's omitted large-file bodies (`encoding: none`),
  preventing an existing template from opening as blank editable content.
- Updated Astro, Vue, js-yaml, Vitest, Wrangler, compatible Worker types and affected
  transitive dependencies. Registry audits now report zero vulnerabilities in the
  root, admin and bot trees. This is advisory coverage, not proof of exploit absence.

The approved [Superdesign canvas](https://superdesign.dev/teams/91a30fa9-8874-4c73-b8d8-b384d0672ecf/projects/5e9a2a54-6f5f-4552-ae6e-e7a07f9586fc)
and `.superdesign/resume.json` preserve the design direction. Generated source
snapshots and transient HTML are ignored. The user requested no further design
iteration after approving this implementation.

## Verification

- 393 Functions/script tests and 445 CMS tests passed.
- Admin typecheck/build and a clean `npm run build:admin` installation/build passed.
- `npm run check:site`: zero errors, zero warnings.
- `node bin/lanza.mjs build`: 15 pages built successfully.
- `npm run check`: zero errors/warnings, 62 informational hints.
- Bot TypeScript check and Wrangler 4.149.0 deployment dry run passed.
- Chromium checked the actual compiled admin at 1440px and 390px: initial rendering,
  mobile navigation to Pages and back, search/no-match/clear, primary-button colors,
  and no horizontal overflow. Synthetic API reads came from local repository files;
  all browser API mutations were refused. No page errors or attempted writes.
- Chromium checked the real error-dialog component: initial focus, Tab containment,
  Escape, Dismiss and return to the originating button.
- Regression tests cover production versus preview deployments, successful build
  versus deploy stages, failed/canceled/skipped deployment states, search, stale
  collection requests, dialog lifecycle and refused omitted large-file bodies.

Public builds still warn about empty categories/tags/authors and the large public
launch-animation JavaScript chunk. These are not admin build failures. A local
build and Git push do not establish Cloudflare deployment success.

## Remaining review scope

This pass does not complete the original request for a full code/security review
of every admin surface. In particular, authenticated production owner/editor flows,
concurrent production publishing, deployment completion tracking,
theme-undo edge cases and history error states, custom collection URL helpers, recipe
atomicity, session-refresh races and the rest of the settings/editor interactions
still need current-state review and verification. Prior reports are evidence to
recheck, not proof these areas are either vulnerable or already safe. No production
penetration test, account configuration audit or deployment verification was done.

## Contracts consulted

- [Cloudflare deployment listing](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/list/): production filter and deployment-stage fields.
- [GitHub repository contents](https://docs.github.com/en/rest/repos/contents#get-repository-content): omitted content for large files.

## MCP publishing follow-up

The subsequent code-only pass closes the separate MCP publishing gap. Both
`publish` and the new `update_drafts` require the branch commit IDs returned by
`list_changes`. Publishing rejects stale or diverged reviews and uses a non-force
update to the reviewed staging commit. Reconciliation only changes staging and
requires a fresh review. A possibly truncated comparison (300 files) blocks MCP
publication. Tool descriptions and the agent authoring guide describe the new
contract; existing MCP callers must supply both commit IDs.

Validation: 413 Functions/script tests and 445 CMS tests passed, including 20 new
MCP publishing regressions. Site validation reported zero errors/warnings, Astro
check reported zero errors/warnings and 62 hints, the public build generated 15
pages, and the pinned Pages Functions bundler passed. The public build warnings
listed above remain. No live GitHub mutations were used in the regression tests.

A fresh tenant installed the packed package, built all 15 pages, and compiled its
copied Pages Functions successfully. This was local package validation, not an
npm release or a deployment verification.

## CMS publishing follow-up

- Refused malformed comparisons and potentially truncated 300-file lists across
  CMS publishing, pending counts and theme-revert conflict checks. Large reviews
  currently require a complete local Git review; the CMS cannot paginate past
  GitHub's comparison file limit.
- Required an explicit review snapshot for every CMS publish call.
- Software updates now save to staging and link to Review & publish. They do not
  publish other drafts, claim the selected version is live, or advertise the
  retired automatic security-update service. Failed version checks show retry
  instead of claiming the current version is latest. Refreshing the selected
  version also refreshes the publishing security-floor state.

Single-commit file pagination was reviewed separately in the follow-up below.
The comparison guard alone does not prove a commit file list complete.

Validation: 413 Functions/script tests and 455 CMS tests passed. Admin typecheck
and build, site validation (zero errors/warnings), and the 15-page public build
passed. The existing public empty-collection and animation chunk warnings remain.
Chromium exercised the compiled admin with synthetic tenant data: selecting a
version issued only a simulated staging package write, linked to the publish
review, and refused a 300-file review with the explanatory error and disabled
publish button. All API writes were intercepted; no production data was changed
by browser testing. No browser page errors occurred. Deployment remains unverified.

## Theme undo pagination follow-up

Theme undo previously read only one page of the apply commit's changed files.
The GitHub client now reads all pages, pins subsequent requests to the returned
commit SHA, and refuses missing file lists, changed commit IDs, duplicate files,
failed pages and GitHub's 3,000-file ceiling. At the ceiling, a complete local Git
review is required because the API cannot prove the list is complete. Later
renames now flag both the old and new path in overwrite warnings.

Eight new regressions cover multi-page lists, exact page boundaries, failures,
the total-file cap, and a real-client theme plan containing the final file on
page four. No UI layout changed. Live account theme rollback remains unverified.

Contract: [GitHub Get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit)
documents file pagination and the total limit.

Validation: 413 Functions/script tests and 463 CMS tests passed. Admin typecheck
and build, site validation (zero errors/warnings), and the 15-page public build
passed. Existing empty-collection and animation chunk warnings remain.
