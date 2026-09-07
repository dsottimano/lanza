# CMS admin review — September 7, 2026

Follow-up: [local repair results](cms-security-repairs-2026-09-07.md). The findings
below describe the original reviewed commit, before those repairs.

Reviewed commit `4279d67`. Fetched and inspected both `origin/main` and
`origin/staging`; both matched the clean checkout. This is a review, with no
implementation changes, remote writes, provisioning, publishing or deployment.

## Findings

### P1 — Discard can erase changes the owner never reviewed

`admin/src/ui/PendingView.vue:189` confirms a list loaded earlier, then calls
`admin/src/backend/github.ts:514`. `discardDraft()` reads only the production tip
and force-updates staging. It never checks the staging commit that supplied the
confirmation list.

If another person or agent saves after the Review changes screen loads, Discard
also removes those unseen commits from staging. This is separate from the
intentional ability to discard the changes actually shown. The recent publishing
snapshot safeguards do not cover this path.

Require a reviewed commit and reject stale reviews. Prefer a reversible revert
commit applied with a fast-forward-only ref update so a concurrent save causes
rejection rather than disappearing. A preflight read alone still leaves a race.
Confirmed by tracing the caller and request construction; no destructive request
was executed.

### P1 — A failed Brand load leaves Save enabled with defaults

`admin/src/ui/BrandView.vue:40` reports a load failure but clears `loading` in
`finally`. Save is disabled only by `loading` at line 139. The form still holds
`defaultBrand()`, and `saveBrand()` replaces the entire persisted brand block.

Browser reproduction: return HTTP 500 for the initial appearance read, dismiss
the error, restore successful reads and click Save. The CMS attempts a PUT to
`data/appearance.json` carrying the default brand. The review intercepted and
refused that PUT; nothing was saved. A brief read failure can therefore become
an unintended reset of the site's palette, fonts and other brand settings.

Keep a failed-load state that disables edits/saving and provide Retry. Establish
the baseline only after a successful read.

### P2 — Collection lists are unusably narrow on a phone

`admin/src/ui/Sidebar.vue:146` keeps a non-shrinking 240px sidebar plus margins.
`admin/src/App.vue:262` exposes mobile navigation only for settings routes;
collection lists retain the desktop rail.

At a 390px viewport, `/pages/en` leaves entry titles squeezed out of view and
pushes language/New page controls beyond the viewport. Reproduced for owner and
simulated editor roles. Settings screens and the designed-page editor have
separate responsive behavior and render substantially better.

Use a shared mobile navigation drawer for collection lists, review/publish and
other shell routes. Let list header controls wrap. Do not rely only on
`documentElement.scrollWidth`: that check missed the visually overflowing child
content in this review.

Screenshot: `/tmp/lanza-review-mobile--pages-en.png`.

### P2 — Site Health can call a staging preview “Live”

`admin/src/ui/useHealthChecks.ts:317` calls `listDeployments(1)`;
`admin/src/backend/cloudflare.ts` supplies only `per_page`, and the health view
uses the first result without inspecting `environment`. A successful preview
deployment becomes “Live — last deploy …” and supplies the deployment link.
Browser reproduction with mocked Cloudflare responses confirmed a successful
`environment: "preview"` deployment displayed as Live alongside “Branch: main.”

Filter production status requests with `env=production`, distinguish preview
status explicitly, and track the published commit through deployment completion.
The [Cloudflare deployment API](https://developers.cloudflare.com/api/python/resources/pages/subresources/projects/subresources/deployments/methods/list/)
supports that environment filter. The publish screen currently stops at GitHub
success (“Published — the site is rebuilding”), so a later failed build remains
invisible there.

### P2 — CMS public-link helpers ignore declared custom collection routes

`admin/src/backend/site-urls.ts:97` uses a fixed list of posts/pages/taxonomy
routes. `entryPathFrame()` returns null for every other collection, regardless
of its declared `collection.route`. `CollectionList.vue` consequently omits View
links for valid custom types, and editor URL displays cannot represent them.

Derive these paths from the content model and share/test the public route
contract. Existing built-in collections work; this is a custom-type integration
gap, not a broken route on the current homepage.

### P2 — The shared error overlay lacks accessible dialog behavior

`admin/src/ui/ErrorDialog.vue:11` renders an overlay and nested divs without
dialog semantics, initial focus, focus confinement or Escape handling. In the
simulated Brand failure, there were zero dialog/alertdialog/aria-modal elements
and focus remained on BODY rather than Dismiss. Keyboard focus can continue into
the obscured form.

Use a native modal dialog or implement its keyboard and focus behavior, with an
accessible name and focus restoration.

## Other loose ends

- Site Health says the public address is unset and falls back to a deployment
  URL. That is false for this checkout: `astro-config.mjs:83` resolves the declared
  `lanzacms.com` domain before the deployment fallback. Show the effective origin
  and its source.
- Content-type removal remains under Advanced settings. The default UI still
  does not expose collection routes or nested field editing.
- The MCP publishing client still merges a moving staging branch separately
  from the CMS reviewed-commit flow (`functions/_lib/lanza-content.ts:265`).
- Site Health still offers KV/D1/R2 provisioning despite those services being
  deferred for the agreed notebook v1. In particular, the R2 description does
  not explain that existing CMS uploads still use GitHub. Connecting a binding
  alone does not migrate uploads.
- The local designed-page preview had a broken image while running Vite alone.
  Treat this as a development preview finding; it does not prove that image is
  broken on the deployed site.

## Connectivity and verification

- Live `https://lanzacms.com/admin/`: HTTP 200, Cloudflare response, `no-store`,
  CSP, frame restrictions and content-type protection headers present.
- Live unauthenticated Cloudflare proxy: HTTP 401 with “Not authenticated.”
  This confirms the deployed gate responds, not that authenticated upstream
  Cloudflare access works.
- Local authenticated GitHub reads work. Local Site Health explicitly reports
  Cloudflare unconfigured (HTTP 503). Wrangler's read-only deployment listing
  also failed because no Cloudflare API credential was available in its
  environment. Production secret configuration, token scopes, deployment state
  and authenticated Cloudflare operations remain unverified.
- All browser API mutations were intercepted. Initial navigation made no writes.
  Failure reproduction attempted one intercepted Brand PUT.
- Browser pass: desktop 1440×1000 and phone 390×844; Pages, Site Health, Brand,
  Content types, Header & footer, designed homepage and Publish. No uncaught
  application JavaScript errors in the navigation pass. The optional template
  catalog lookup for `templates/parts/fields.json` returns 404.
- Header/footer locale switching with unsaved input prompts; dismissing keeps
  the original URL and edited value. Simulated editor identity hides owner
  navigation. Actual production owner/editor sign-in was not exercised.
- `npm test`: 347 Node tests and 409 CMS tests passed.
- `npm run check:site`: zero errors and zero warnings.
- `npm --prefix admin run build`: type checking and CMS bundle succeeded.
- `node bin/lanza.mjs build`: succeeded, 15 pages. Warnings remain for empty
  posts, tags, categories and authors collections and their downstream reads.
- `npx wrangler@3.114.17 pages functions build --outdir /tmp/lanza-review-fnbuild`:
  compiled successfully with the repository's deployment-compatible bundler.

Passing these checks does not close the findings above. No fixes were deployed.
