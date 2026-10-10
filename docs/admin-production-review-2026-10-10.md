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
theme-undo edge cases and confirmation accessibility, custom collection URL helpers, recipe
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

## Theme-history failure handling

History load failures now show retry instead of an empty-history claim. The empty
state describes its actual latest-30-commits window. Cancel discards the plan;
uncertain revert failures also discard it and instruct the owner to check staging
before a fresh review. The screen no longer claims that no commit occurred after
a lost response. Late failures after leaving the screen do not open global errors.

Validation: 413 Functions/script tests and 469 CMS tests passed, including six
new state-transition regressions. Admin typecheck/build, site validation (zero
errors/warnings), and the 15-page public build passed; existing public build
warnings remain. Chromium exercised the real component's failed-load retry,
cancel and uncertain-write recovery with synthetic client methods and blocked
API traffic. No live rollback or deployment verification was performed.

## Authentication refresh failure handling

A GitHub outage during refresh previously cleared sign-in cookies as though the
refresh token had been revoked; a thrown network error could escape middleware.
OAuth response parsing now handles transport/malformed failures, refuses token
bodies on failed HTTP requests, and treats throttling/server errors as unavailable.
The gate preserves cookies and returns 503 for unproven credential failures, while
an explicit bad refresh token still clears them and denies access. Successful
refreshes still require repository authorization before downstream execution.

Sixteen new regressions drive the real gate and cover outage formats, throttling,
malformed bodies, configuration errors, pending responses, explicit invalid-token
responses, token-shaped HTTP errors and authorization after rotation. Existing
request stubs now use real Response objects so HTTP status handling is exercised.
Cross-request refresh races remain open; no broader credential or token store was
introduced. No live sign-in or token rotation was performed.

Contract: [GitHub user-token errors](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
documents the bad-refresh-token response.

Validation: 429 Functions/script tests and 469 CMS tests passed. Site validation
reported zero errors/warnings. The public build and a fresh packed-package tenant
each built 15 pages; both Pages Functions bundles compiled using the required
Wrangler version. Existing public build warnings remain. Deployment is unverified.

## Account-switch cookie cleanup

Logout previously omitted the pending agent-device cookie. A new sign-in also
reused refresh-oriented cookie handling, which could retain an old account's
refresh credential if the new response omitted one. Logout now clears all auth
cookies. Successful new sign-ins clear the old agent flow and either replace or
remove the refresh credential. Ordinary token refresh preserves an agent flow in
progress. This is cookie cleanup, not revocation of already exported agent tokens.

Four regressions drive the real sign-in/logout/agent-poll handlers with a cookie
jar: logout, new sign-ins with/without refresh tokens, and ordinary rotation. A
post-cleanup agent poll requires restarting and never calls GitHub with the old
code. Live multi-account authentication and concurrent response ordering remain
unverified.

Validation: 433 Functions/script tests and 469 CMS tests passed. Site validation
reported zero errors/warnings. Public and fresh packed-tenant builds generated
15 pages each, and both Pages Functions bundles compiled. Existing public build
warnings remain; no live sign-in, account switch or deployment was verified.

## Atomic software version saves

Software updates previously removed package-lock.json and saved package.json as
two separate commits. A failure between them left a partial update. The version
save now reads an immutable staging head and submits the package edit and any
existing lockfile removal in one checked Git tree/commit, with a non-force branch
update. Only a 404 means the lockfile is absent; other read failures stop the save.
Unrelated package fields and dependencies remain intact.

Seven new real-client tests cover lockfile presence/absence, failures at each
pre-publication stage, and a racing branch edit. 433 Functions/script tests and
476 CMS tests passed. Admin typecheck/build, site validation (zero errors/warnings)
and the 15-page public build passed. Chromium exercised the compiled Software
screen with intercepted API traffic: one synthetic staging ref update, no
production update, then the existing publication review. Existing build warnings
remain. Live software installation/deployment is unverified.
