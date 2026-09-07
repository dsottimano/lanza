# Security, recovery and agent-extension review — September 7, 2026

Follow-up: [local repair results](cms-security-repairs-2026-09-07.md). The findings
below describe the original reviewed commit, before those repairs.

Reviewed `4279d67`, after fetching both main and staging and confirming they
matched. Preserved the earlier uncommitted CMS review. Application code and
remote branches were not changed. All write reproductions used synthetic
credentials, intercepted requests, or disposable local Git repositories.

## Findings, ordered for remediation

### P1 — Editor Git-data writes bypass the owner-only file boundary

Location: `functions/_lib/roles.ts:178–204`, used by the real GitHub proxy.

The policy validates explicitly supplied tree-entry paths, allows arbitrary
commit objects, and permits moving staging without validating the candidate
commit's complete tree or ancestry. It also permits `force:true` for an editor's
staging update.

Reproduction used the real production proxy handler and local Git as its fake
upstream. An editor submitted a tree containing only `content/note.md` with no
`base_tree`, created a commit parented by the existing staging tip, and moved
staging with `force:false`. All three requests passed. The resulting tree deleted
`data/site.json` and `package.json`; production remained unchanged.

This follows GitHub's documented behavior: a newly created tree without a base
does not retain omitted files. See [Git trees API](https://docs.github.com/en/rest/git/trees).

This is a bypass of the CMS's promised narrower editor role, not an
unauthenticated attack or an escalation of that collaborator's underlying GitHub
permissions. It can corrupt drafts and trigger broken preview builds.

Remediation: put editor transactions behind a server-owned commit builder, or
validate the complete proposed tree against a pinned staging tip before a
fast-forward-only ref update. Validate file modes as well as paths. Requiring
`base_tree` alone is insufficient: callers can select another base or reference
an existing tree directly when creating a commit.

Evidence: `/tmp/lanza-security-proxy-repro.mjs` and its `.log`;
local fixture `/tmp/lanza-proxy-fixture-l1GW3J`.

### P1 — Settings and template conflicts silently overwrite newer data

Location: `admin/src/backend/github.ts:246–262`.

`putRaw()` catches a 409, fetches the latest blob SHA and resends the original
payload. It does not merge or ask the owner to review the newer content.
`saveJson()` and `saveText()` use this path, including menus, schema, redirects,
saved snippets and template source. The newer entry-save path has stricter
semantics; this finding should not be generalized to every entry save.

Reproduction used the real GitHub client with a fake upstream: a menu save with
an old SHA received 409, read a newer owner's SHA, then successfully replaced the
owner's link with the stale form's link. Both attempted writes carried the same
old payload. `putJsonSafe()` also cannot preserve keys changed between its read
and the subsequent retry because its merge callback is not rerun.

Remediation: surface conflicts and retain local edits. Where automatic merging
is justified, reread the content and rerun a deliberately scoped merge, with a
bounded retry. Do not turn an optimistic-concurrency failure into last-write-wins.

Evidence: `/tmp/lanza-security-save-repro.mjs` and its `.log`.

### P1 — Theme rollback does not pin the reviewed draft

Location: `admin/src/backend/themeHistory.ts:121–159` and
`admin/src/backend/github.ts` (`commitTreeChanges` / `writeCommit`).

The plan checks for conflicts against the current staging branch but retains no
reviewed head. Execution then reads a fresh head and applies the old inverse
changes on top. A write arriving after the confirmation was prepared is included
in history but can be silently removed from the resulting files.

In the real theme round trip below, a clean rollback plan was prepared, an owner
then edited a page created by the theme, and the old plan deleted that page
without reporting the new conflict. Already-existing edits were correctly
reported when they preceded planning. Git retains recoverable history here;
the defect is the stale confirmation and loss from the working tree.

Remediation: retain the reviewed staging SHA, recheck it, and parent the revert
commit on that exact SHA. Refuse a concurrent advance instead of rebasing the
old plan silently. Apply the same reviewed-state contract to theme installation.

Evidence: `/tmp/lanza-security-theme-roundtrip.mjs`, its `.log`, and
`/tmp/lanza-security-theme-result.json`.

### P1 — The recipe CLI overwrites existing files and can leave a partial install

Location: `scripts/apply-recipe.mjs:118–175`.

The collision check only covers collection names. Existing template files,
seed content and `data/styles.json` are overwritten without `--force`.
Some reads and JSON parsing also occur after the write phase starts.

Two isolated reproductions using the checked-in event recipe:

- A destination with an existing owner-written `templates/event/template.html`
  and style catalog was overwritten; the CLI returned success without `--force`.
- A destination with malformed `data/menu.en.json` failed after replacing the
  template, styles and schema. It did not satisfy the documented “nothing written”
  guarantee.

Remediation: plan and validate every input and destination first, check collisions
for every affected path, preserve unrelated style entries, and apply through a
transaction or recoverable checkout. The newer starter planner is a separate
implementation; these reproductions concern `apply-recipe.mjs`.

Fixtures: `/tmp/lanza-recipe-collision-j1wskkg3` and
`/tmp/lanza-recipe-late-failure-gir98_co`.

### P2 — Safe image extensions are enforced only in the browser uploader

Location: `admin/src/backend/media.ts` and
`functions/_lib/roles.ts` (`EDITOR_WRITE_PREFIXES`, Contents and tree writes).

The UI rejects HTML and SVG uploads, but the server permits an editor to PUT
`public/images/uploads/review.html`. The real proxy forwarded a synthetic HTML
upload in the reproduction. The Git-data path has the same extension gap.

These assets are served on the public site's origin, shared with the admin.
An HTML document is an executable document when navigated to; `nosniff` does not
convert HTML into a safe image. Publication and owner navigation are additional
conditions for a production-origin attack. This review did not execute such an
attack against an authenticated production browser.

Remediation: enforce the supported upload types server-side across every write
path. Consider an isolated asset origin or restrictive response policy for
uploaded documents if document uploads are introduced. HttpOnly cookies alone
do not prevent same-origin scripts from invoking authenticated admin requests.

Evidence: `/tmp/lanza-security-session-repro.mjs` and its `.log`.

### P2 — Concurrent rotating refreshes can clear a fresh session

Location: `functions/admin/_middleware.ts:175–185`.

Each request refreshes independently. The reproduction ran two real middleware
requests with the same expired access cookie and refresh cookie. The fake GitHub
upstream accepted the first refresh and rejected the second as spent. One
response returned 200 with fresh auth cookies; the delayed second returned 401
and clearing cookies. If it arrives last, the browser loses the fresh session.

GitHub documents that using a refresh token invalidates the previous token pair:
[refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens).

Remediation must cover concurrent requests and tabs without creating a broker
token store. Avoid having a losing refresh response erase newer cookies; design
serialized refresh/retry behavior and test response ordering. An isolate-local
promise cache alone does not coordinate requests reaching different isolates.

Evidence: `/tmp/lanza-security-session-repro.mjs` and its `.log`. The upstream
rotation outcome was simulated; no production user's session was expired.

## Agent-created extension: what actually worked

Created a synthetic **Review Studio** bundle with four files:

- `templates/review-studio/fields.json`: Heading and Introduction declared once.
- `templates/review-studio/template.html`: markup and namespaced CSS, no scripts.
- `content/pages/en/review-studio.md`: one Pages entry using preset and slots.
- `data/appearance.json`: a fixture accent change to exercise restoration of an
  existing file as well as deletion of newly added files.

The real packer, `parseTheme()`, `applyTheme()`, GitHub client and rollback code
were exercised against a local Git-backed API adapter. No application client was
replaced by a simplified imitation; only GitHub's transport was simulated.

Verified:

1. Bundle parsed and installed in one commit.
2. Site validation/build passed and generated `/review-studio/` in English.
3. Changing the entry's Heading slot changed the actual production-rendered HTML.
4. In a real browser, **Pages → English → review-studio** displayed the declared
   fields. Editing Heading updated the preview immediately, with no JavaScript
   errors or API writes. Its sandbox did not include `allow-scripts`.
5. A prior edit appeared in rollback's conflict list.
6. Approved rollback restored the complete original tracked Git tree exactly,
   including existing content and appearance. The rebuilt fixture no longer
   contained `/review-studio/`.
7. A second test reproduced the stale-plan failure described above.

Fixture bundle: `/tmp/lanza-extension-source-fyndZh/review-studio.tar.gz`.
Fixture checkout: `/tmp/lanza-extension-fixture-kzjDWx`.
Browser evidence: `/tmp/lanza-security-extension-browser.png` and `.log`.
These are test artifacts, not a theme installed on the product site.

This demonstrates a useful first extension format: declared fields, content,
templates and styles. It does **not** establish a sandbox for arbitrary plugins.
The current theme file set includes executable Astro/TypeScript build inputs;
trusting that code remains part of importing such a theme. No general plugin
runtime or permission system was implemented in this pass.

## Protections and checks that passed

- 347 Node tests and 409 CMS tests passed, including the existing adversarial
  proxy/path, role, auth, renderer and theme-import cases. The new reproductions
  demonstrate coverage gaps despite that passing baseline.
- A separate test of the real identity cache confirmed cached authorization at
  59 seconds and fresh denial after the 60-second expiry.
- Both root and admin `npm audit --json` returned zero known advisories. This
  does not prove the dependency graph or application is vulnerability-free.
- Scanned 123 generated admin/public files for the one available configured
  secret value, both literal and base64: no matches. Common GitHub-token and
  private-key signature scans also found no matches in those outputs. This was
  not an exhaustive historical Git-secret audit.
- `npm run check:site`: zero errors and warnings.
- `npm --prefix admin run build`: type checking and bundle succeeded.
- `node bin/lanza.mjs build`: 15 pages built successfully. Empty posts, tags,
  categories and authors warnings remain.
- The isolated extension passed installed, edited and reverted builds.
- Pages Functions were compiled with the repository-required Wrangler 3.114.17.

## Remaining scope and next implementation order

The earlier [CMS review](cms-admin-review-2026-09-07.md) still applies, particularly
Discard's force-reset race and Brand's failed-load overwrite. No findings have
been fixed or deployed by this review.

Fix the editor Git-data boundary first, then stale saves and destructive recovery
paths, then recipe transactions and refresh behavior. Use the generated extension
fixture as an acceptance case before expanding theme/plugin capabilities.

Live authenticated Cloudflare API access, production token scopes, real role
revocation, multi-region refresh ordering, broker onboarding and Meta integrations
remain unverified. This pass did not add credentials, provision services, release
a package, publish content or deploy anything.
