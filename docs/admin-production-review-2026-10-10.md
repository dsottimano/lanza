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

## Identity cache and throttling

GitHub can return 403 for throttling. The identity helper previously cached that
as a permission denial. Recognized primary/secondary rate limits now return
unavailable, so the API gate responds 503 without clearing cookies or running
protected handlers. No automatic retries were added. Genuine 403/404 access
refusals retain their existing behavior.

The cache key now includes the repository as well as the token hash. Tests show
that cached owner/denied results for one repository cannot answer another's check;
case-only variations of the same repository still share the answer. Normal tenant
handlers use one configured repository, so this is helper-level isolation rather
than evidence of a demonstrated cross-tenant exploit.

Seven regressions cover rate-limit formats, cache recovery and repository scope,
and refusal through the real middleware. Contract: [GitHub rate-limit troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api).

## Live deployment evidence from the preceding pass

Cloudflare's production deployment listing identified code commit `6f9a7e1` as
active at deployment `6a384c42-2017-4770-ad53-33294bea364d`. Live Chromium checks at
390px and 1440px found a working sign-in screen, no overflow or page errors, and
401 responses from the unauthenticated admin API. Headers retained admin no-store,
CSP and frame restrictions; the public homepage remained cacheable. Live logout
cleared all four auth cookies. GitHub check 114234552044 still showed in-progress
when inspected, so its state lagged/disagreed with Cloudflare's active listing.
These checks do not verify authenticated owner/editor writes or later deployments.

Identity-pass validation: 440 Functions/script tests and 476 CMS tests passed.
Site validation reported zero errors/warnings; public and fresh packed-tenant
builds each generated 15 pages, and both Pages Functions bundles compiled.
Existing build warnings remain. No live throttling or multi-repository access
test was performed.

## Custom collection preview links

The CMS now reads custom detail routes from the loaded schema instead of omitting
links for every non-built-in collection. Localized routes follow the selected
language and URL mappings; shared custom routes use their entry ID at the root,
matching the public generator. Missing or malformed route declarations yield no
link. This fixes navigation without adding design changes or altering content.

Validation: 440 Functions/script tests and 480 CMS tests passed, including four
new route regressions. Admin typecheck/build, site validation (zero errors or
warnings), and the 15-page public build passed. A temporary packed tenant with
localized and shared event collections built 23 pages. Chromium loaded the
compiled admin with mocked read-only API data and verified both preview URLs
against the generated files, with no page errors or writes. The first temporary
fixture used an invalid hyphenated collection identifier; correcting that fixture
to an underscore identifier allowed the build to pass. Existing empty-collection
and large-chunk build warnings remain. Authenticated production writes and this
commit's deployment are not verified.

## Content type identifiers and generated bindings

The new-type form advertised and accepted hyphens and leading digits, but those
names fail the content-config generator. It now follows the declared identifier
shape and explains that shape beside the input. Names such as `class`, `z`, or
`collections` previously passed shape validation but broke generated JavaScript.
The generator now assigns its own numbered bindings and exports computed string
keys, preserving the actual collection names without inserting them as code.
The checked-in generated config was regenerated by the normal site build.

Regression coverage imports generated output with keyword/import/binding collision
names and verifies the exported collection keys, including `__proto__`. CMS tests
exercise invalid and valid names, creation/save, and preservation of custom route
metadata. All 441 Functions/script tests and 482 CMS tests passed; the strengthened
generator suite also passed separately. Admin typecheck/build, site validation
(zero errors/warnings), the 15-page root build, and a fresh packed tenant build
with an additional `class` collection passed. Chromium exercised the compiled
new-type form through mocked read-only APIs, with no page errors or writes.
Existing empty-collection and large-chunk build warnings remain; authenticated
production saves and deployment of this change are unverified.

## Generic settings read/save races

The generic JSON settings editor exposed an empty form after a failed read and
cleared the dirty flag unconditionally after saving. It now requires a successful
read before editing/saving, offers retry, and ignores superseded or unmounted
loads. Saves capture an immutable JSON snapshot; completion advances the SHA but
leaves edits made during the request dirty. Dirty tracking observes the actual
form data, including mutations that do not bubble an input event. Late saves do
not clear a different editor's dirty state. The shared SaveButton also suppresses
late success/error events and timers after unmount.

Seven regressions cover failed read/retry, in-flight edits, SHA advancement,
superseded loads, failed writes, unmount, and late save-button outcomes. All 441
Functions/script and 489 CMS tests passed. Admin typecheck/build, site validation
(zero errors/warnings), and the 15-page public build passed. Chromium verified the
compiled settings failure/retry state through mocked API reads, with no browser
errors or writes. Existing build warnings remain. This pass covers the generic
settings editor; specialized settings panels still require equivalent race
review. Authenticated production writes and this deployment remain unverified.

## Content type and language save snapshots

Content type saves now detach their serialized snapshot from the reactive form.
This prevents nested edits during a request from being applied to the live schema
as though those edits were committed. Successful completion only clears dirty
state when the current serialized form matches the submitted snapshot. Reactive
tracking also catches nested field changes. Completion after unmount leaves the
new editor's dirty flag alone.

Language saves freeze both the selected languages and default before the merge
read. Previously that read could combine the earlier language list with a later
default selection. Completion retains newer edits as unsaved, and an unmounted
panel no longer emits saved or clears another editor's dirty flag. Both save
functions guard against concurrent invocation.

Four regressions cover in-flight edits, the next save, immutable language/default
pairs, preservation of unrelated site settings, and unmount behavior. All 441
Functions/script and 493 CMS tests passed. Admin typecheck/build, site validation
(zero errors/warnings), and the 15-page public build passed. The compiled content
type form loaded and passed browser creation/validation checks using mocked API
reads with no writes or page errors. Existing build warnings remain; live saves
and deployment are unverified. Other specialized settings panels remain in scope
for the ongoing review.

## Redirect settings failure and save handling

Redirects now blocks editing/saving after failed reads or malformed redirect-list
shapes and provides retry. A genuine 404 still allows creation. Successful reads
retain unrelated top-level settings for the next write. Saves capture the form
snapshot, advance the SHA, and keep subsequent edits dirty; completion after
unmount cannot clear another editor's warning. Concurrent saves are guarded.

The status copy previously said Save would publish and labeled the latest
Cloudflare deployment as proof the rules were live. It now explains staging and
review/publish, and identifies the deployment as context rather than confirmation
that the current rules are deployed. No visual redesign was added.

Six regressions cover read failures, malformed files, retry, first creation,
in-flight edits, preserved metadata, SHA advancement and unmount. All 441
Functions/script and 499 CMS tests passed. Admin typecheck/build, site validation
(zero errors/warnings), and the 15-page public build passed. Chromium confirmed
the compiled redirect editor blocks save after a mocked read outage and recovers
on retry, with no page errors or writes. Existing build warnings remain; actual
production redirect writes and deployment of this commit are unverified.

## Saved snippets read/save handling

Saved snippets now blocks editing after a failed read and provides retry. The
loader rejects malformed lists, invalid entries and duplicate IDs instead of
silently filtering them out and allowing the remaining subset to overwrite the
file. A genuine missing file still starts an empty library. Valid entry metadata
is retained when loading.

Saves flush the current editor into a detached snapshot and track edit revisions,
including editor change events. Completion updates the SHA but leaves subsequent
edits dirty; after unmount it cannot clear another editor's warning. Concurrent
saves are guarded. Eight regressions cover failed reads/retry, malformed entries,
duplicate IDs, first use, in-flight edits and unmount behavior.

All 441 Functions/script and 507 CMS tests passed. Admin typecheck/build, site
validation (zero errors/warnings), and the 15-page public build passed. Chromium
verified failed-read blocking and retry in the compiled snippet manager through
mocked reads, without page errors or writes. Existing build warnings remain;
authenticated production writes and deployment of this change are unverified.

## Atomic header/footer/navigation saves

The header/footer editor previously committed the menu and each changed template
separately. A failure midway left a partial update. It now captures all changed
files before awaiting and uses the existing checked Git transaction to validate
loaded SHAs and commit the entire change at once. Only changed files are included.
On success it advances their SHAs and compares current values with the submitted
snapshot so later edits remain dirty. Failed commits retain all pending changes.

Load results carry a generation guard, so older locale reads and responses after
unmount cannot replace the current form or clear its dirty state. Save completion
uses the same guard. Tests retain real header/footer markup and cover localized
menu isolation, atomic submission, newer edits, conflict retention, unmount and
superseded locale loads.

All 441 Functions/script and 511 CMS tests passed, along with admin typecheck/build,
site validation (zero errors/warnings), and the 15-page public build. Chromium
verified the compiled editor loads and tracks template edits with mocked API
reads and no page errors or writes. The transaction helper's existing regression
suite passed; this pass did not execute authenticated production writes. Existing
build warnings remain and deployment of this change is unverified.

## Brand appearance conflicts and late responses

Brand previously merged its complete local brand snapshot into the most recent
appearance file, without checking the version that supplied the form. A second
editor's brand changes could therefore be overwritten. Loading now retains the
appearance SHA; saving compares that version before writing and uses it as the
write precondition. Success advances the version for subsequent edits. Unrelated
appearance properties remain preserved, and conflict failures retain local edits.
Late load failures and save completions after unmount no longer affect another
panel's error/dirty state. Duplicate direct save calls are guarded.

Plugins already saves against its loaded appearance SHA and preserves unrelated
properties; its existing conflict/permission regressions passed in this run.
Four new Brand regressions cover newer remote data, successive saves, unmount and
late read errors. All 441 Functions/script and 515 CMS tests passed. Admin
typecheck/build, site validation (zero errors/warnings), and the 15-page public
build passed. Chromium checked the compiled Brand panel's edit/cancel behavior
with mocked reads and no page errors or writes. Existing build warnings remain;
authenticated production changes and deployment are unverified.

### Current completion evidence gaps

The earlier remaining-scope paragraph is historical: custom links, software
staging, theme-history failure states and several settings save paths now have
specific evidence below it. They do not prove the complete original objective.
Remaining verification includes authenticated owner/editor production flows,
session-refresh concurrency, starter/recipe installation atomicity, remaining
editor/media interactions, and confirmation cancellation/accessibility. The
current UI file inventory and these passing suites are an index for continued
review, not proof that every control or security invariant is covered.

## Save confirmation cancellation

Cancelling the invalid-redirect confirmation previously resolved its save action
normally, so SaveButton displayed Saved and emitted success despite no write.
Save actions can now resolve false to signal cancellation. Redirects uses that
result; the button returns to idle without emitting saved/error, and local edits
remain dirty. A subsequent confirmed save still succeeds.

Two regressions cover cancellation and a later confirmed save. All 441
Functions/script and 517 CMS tests passed. Admin typecheck/build, site validation
(zero errors/warnings), and the 15-page public build passed. Chromium dismissed
the native confirmation in the compiled redirects panel and verified Save plus
unsaved status remained, with no API writes or page errors. Existing warnings
remain; production writes and deployment are unverified. Inspection also
identified the advanced template-source editor's load/save lifecycle as requiring
further review; this cancellation fix does not establish that editor's safety.

## Advanced template source request isolation

The advanced template editor previously accepted late source reads after a
preset switch, allowing the old template's HTML and SHA into the new selection.
Source requests now carry a generation tied to that selection and are ignored
after switching or unmount. The disclosure resets with each template. Failed
reads expose retry without an editable source or save action. Saves capture the
selected file/text/version, guard concurrent invocation, and cannot apply their
returned SHA to another template. Cancelled/superseded saves do not report success.

Four regressions exercise failed read/retry, late reads, late saves, and unmount.
All 441 Functions/script and 521 CMS tests passed. Admin typecheck/build, site
validation (zero errors/warnings), and the 15-page public build passed. Compiled
admin smoke checks at 1440px and 390px verified navigation/search without overflow,
page errors, or writes. These smoke checks do not simulate template request races;
the component tests do. Source-edit navigation/dirty warnings remain a separate
open review item. Existing build warnings remain; live writes and deployment are
unverified.

## Independent template-source unsaved warnings

Template source edits now own an additional dirty flag observed by the common
route-discard and beforeunload guards. Saving the surrounding page cannot clear
that flag. Each independently saved editor owns/disposes only its own flag; the
existing page dirty flag remains intact. Template-source save completion advances
its baseline to the submitted text, so edits made during the save remain dirty.
The panel displays the source-specific unsaved status and disables clean saves.

Switching templates through the picker asks before discarding source edits.
Cancelling restores the displayed selection and retains the source; accepting
resets the source editor for the selected template. Three regressions cover
navigation/tab-close guards, page-save independence, cancellation, concurrent
edits and owner cleanup.

All 441 Functions/script and 524 CMS tests passed. Admin typecheck/build, site
validation (zero errors/warnings), and the 15-page public build passed. Chromium
mounted the actual Vue template editor through Vite with synthetic client methods
and verified page-save independence, native confirmation cancellation, and source
save clearing its own warning. No actual API writes or page errors occurred.
Existing build warnings remain; live writes and deployment are unverified.
