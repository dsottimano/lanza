# CMS navigation and automatic addresses

Local changes; not committed, pushed, or deployed.

- One owner-only Review & publish sidebar entry leads to the detailed pending
  review, then the existing final publish screen. Hidden with no known changes;
  retained while a review screen is active so navigation does not disappear.
- Top-bar View staging and View live site share the address resolver with Site
  health. Explicit site.url wins, then the declared production domain, then the
  Pages project hostname. Staging uses the project and configured working branch.
  No Cloudflare connection or duplicate saved URL is required. This site's build
  already derives lanzacms.com from lanza.config.json; settings now reflects it.
- Advisory count: one comparison on owner boot, debounced after successful file/ref
  writes, and throttled on window focus. No periodic polling or per-file reads.
  Publish still obtains its own immutable review and rechecks branch tips.
  URL discovery runs outside the boot gate. These are targeted efficiency checks,
  not a measured whole-application performance audit.
- Existing local themes/plugins work was preserved. Both remote branches were
  fetched and inspected: both contain bf3df31, a newer CMS appearance edit. No
  branch movement was performed. Reconcile it before any future publish/push.

Validation: 393 Node tests and 428 CMS tests passed; admin typecheck/build and
lanza build passed; check:site reported zero errors/warnings. Static HTTP smoke
check returned 200 for /admin/ and all four referenced entry assets. Build warnings:
empty posts/authors/categories/tags collections and unresolved Jost/JetBrains Mono
font paths. Authenticated browser interaction, responsive visual review and remote
build/deployment availability remain unverified.

## Follow-up bug fixes

- Corrected Vite font references to use public-root paths; Vite applies /admin/
  itself. Both generated CSS URLs resolve to valid WOFF2 assets in public and dist.
  Admin build now has no font warnings.
- Failed pending-change checks retain the last successful count and expose Retry.
  New writes invalidate older responses immediately; revoked owner access clears
  state and cannot be repopulated by an older request. Regression tests cover
  failures, retries, stale failures and access changes.
- Revalidated: 393 Node tests, 431 CMS tests, admin build/typecheck, check:site and
  lanza build passed. Empty-collection diagnostics remain: those collections are
  intentionally empty, not malformed. Browser interaction and deployment are still
  unverified. Remotes were fetched again; newer appearance edits remain untouched.
