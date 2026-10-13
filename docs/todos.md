# Public release recovery — October 13, 2026

Product main and staging now contain the integrated feature work at `ab9d01b`.
Tag `v0.1.26` completed the trusted-publishing workflow successfully:
https://github.com/dsottimano/lanza/actions/runs/38425473067.
npm `latest` is verified as **0.1.26**, with signed provenance. A clean tenant
downloaded the public registry tarball, built successfully and passed legacy Pages
Functions compilation. Its integrity matches the locally tested tarball exactly.
The onboarding template now pins 0.1.26 at `dsottimano/lanza-template` commit
`41153bfb2040e7c84d8417dc0d2b69da340c8a58`, verified on remote main. npm processing
took several minutes after CI succeeded; the template was updated only after the
public download/build passed.

Next release action: the friend's existing 0.1.16 site needs its owner to stage the
0.1.26 software update, review/publish it and verify its deployment. Its URL and
repository were not provided; no existing tenant was automatically upgraded.
AGENTS.md and CLAUDE.md now require live npm/template checks and an explicit release
question when publication is not already authorized.

Current checks: 491 server/script tests and 639 CMS tests passed; CMS build and
typecheck, Astro check (0 errors, 99 hints), site checker (0 errors/warnings),
public build, packed fresh-tenant build, draft exclusion and legacy Pages Functions
compilation passed. Existing empty-taxonomy and large-chunk warnings remain.
Optional Worker integrations have separate typechecks and are excluded from the
Astro project; they are not shipped in the npm package. Browser interaction and a
friend's existing-site upgrade are not established by these checks.

# Previous provenance delivery — October 11, 2026

Shared source now implements agent text provenance; see [contract](agent-provenance.md).
Verified 491 server/script tests and 639 CMS tests, CMS typecheck/build, site checker
(0 errors/warnings), public build, legacy Pages Functions compilation and a real
browser editor round-trip. Private package 0.1.26 is installed and built in Pananómica.
Public npm release and product main integration were pending at that checkpoint.
The existing task queue follows; these checks do not claim unrelated backlog completion.

# Lanza work list

Updated 2026-10-10. Start here after clearing conversation context.

## Read first

1. [Product vision](product-vision.md): agreed direction and v1 boundaries.
2. [Thoughts v1](thoughts-v1.md): implementation contract and unresolved mechanics.
3. [Current handoff](handoff-2026-10-10.md): worktrees, tenant state and next session.
4. [Delivery evidence](agent-requests-delivery-2026-10-10.md): shipped CMS fixes and limits.
5. [Security model](security-model.md) before touching auth, repository access or MCP.

The previous 746-line list is preserved in [TODO history](todos-history.md).
It is historical evidence, not the current queue. Do not repeat old auth migrations,
release old package versions, or treat old test counts as the current baseline.

## Active plugin integration — October 11

`lanza` on `feat/plugins-cms` now incorporates `feat/agent-requests` and all three
research-collector commits. Retained local CMS changes were compared and reconciled;
the pre-integration stash and `/home/dsottimano/source/lanza-recovery-20261011-105359`
preserve the original files. No tenant publication or remote push occurred.

Plugin API v1 and the manual Research workspace are implemented; see
[plugin contract](plugins-v1.md). Remaining product expansion: scheduling with an
explicit tenant runtime, multi-article research, historical snapshot browsing,
custom CMS component adapters and reviewed data migrations. Do not claim that the
old standalone collector cron drives the CMS refresh or its disable switch.

## Next session: content first

- [ ] Continue **Article 1 — How Earthquake-Proof Is Panama City?** with the human's
  latest saved prose. Read current staging and private requests before changing
  anything. Verify factual claims against primary sources; distinguish magnitude,
  local shaking and building performance. Do not rewrite the author's voice wholesale.
- [ ] Complete the requested research workflow: inspect the existing research
  schema/UI and collector before adding more. Prove a deterministic refresh from
  recorded sources, dated snapshots and a reviewable diff. Worker deployment and
  cron execution are not established; do not mark them working from local tests.
- [ ] Review the new staging homepage with the owner. Writer now owns `/` through
  Pages → English → Home; starter copy is still placeholder copy. Old setup content
  is a draft backup. Publication remains the owner's Review & publish action.
- [ ] Create a Spanish article draft when requested, using the existing translation
  tools and latest source SHA. No Spanish article was created as a test.

## Product follow-ups from the real tenant

- [ ] Make request status unambiguous: **Resolved is not Answered**. A request with
  no reply must not suggest that the assistant supplied one. Preserve existing
  requests; verify answer rendering and the no-answer state in the real browser.
- [ ] Finish the real ChatGPT connection proof. Inspect existing OAuth Worker,
  plugin template and MCP instructions first. Ordinary browser/terminal sessions
  cannot read an unsaved live editor. Saved requests do not wake a chat. See
  [connection status](chatgpt-integration.md); client setup remains unverified.
- [ ] Audit privacy setup and public→private repository transitions. Preserve the
  already-private tenant; check existing implementation before coding. Offer an
  explained repository-visibility choice during onboarding and in Settings, with
  clear consequences for public source versus a public website.
- [ ] Verify owner/editor concurrent publishing, session-refresh races and remaining
  media/editor cancellation/accessibility against the latest code. Existing live
  tests cover specific interactions, not every workflow.
- [ ] Show deployment completion/failure separately from successful Git publication.
- [ ] Review CLI recipe write-phase failures and concurrent filesystem changes;
  input preflight is not a rollback transaction.
- [ ] Evaluate server-side publication protection; the local hook is not a
  repository-wide policy.

## Release and integration

- [x] Reconcile the integrated feature work with product main/staging and retained
  local work. Both remote branches now contain `ab9d01b`; no content conflicts.
- [x] Run the current suite, explicitly rebuild CMS assets, validate the packed
  fresh tenant and compile Pages Functions. See the October 13 checkpoint above.
- [x] Release shared npm 0.1.26 through GitHub trusted publishing, verify the public
  package in a clean tenant and update the onboarding template. Existing private
  tarball tenants remain separate upgrades; source, package and deployment differ.
- [ ] Verify each intended deployment against its commit and actual URL, including
  staging and production. Preserve CMS edits through every reconciliation.

## Completed this session

Implemented in the shared feature branch and delivered to Pananómica: highlighted
text requests and replies, selection-anchored actions, Delete post, clearer
publication controls, clipboard image upload/removal, language navigation,
MCP translation tools, starter homepage choice with draft backup, and language
chooser escape controls. The installed tenant homepage was separately corrected
on staging. See [delivery evidence](agent-requests-delivery-2026-10-10.md) and the
[current handoff](handoff-2026-10-10.md). This is not a public npm release or proof
of automatic ChatGPT connection.

## Locked product decisions

- Lanza helps people capture, develop, own and eventually publish human thought.
- People talk with ChatGPT or Claude, ideally in voice mode. Their connected
  assistant organizes and saves thoughts. Do not build another chat app or voice
  recorder in the CMS as the first step.
- V1 stores portable notes in the person's private GitHub repository. D1/R2 are
  deferred, not prerequisites. A second repository is not required for v1.
- Notes stay outside website collections and public output. Private repo source
  can coexist with a public website; repo collaborators can still read the notes.
- Human contributions, assistant interpretations, sources and revisions remain
  distinguishable. Git authorship does not prove human thought.
- The CMS supports reviewing, finding, developing and curating thoughts and public work.
- Preserve sovereign auth: no broker-held customer credential.
- Plugins are built by an agent for the human and owned in the human's repository.
  No third-party plugin installation or marketplace.

## Optional domain and monetization setup

- [ ] **Connect a domain without nagging.** Add Site settings → Domains with the
  current address and an optional Connect a domain action. Offer a secondary
  “Optional: connect your domain” link on onboarding success. No banners, badges
  or pending tasks. Explain provider-specific DNS changes, check connection and
  HTTPS status, and keep the existing address working during setup. Expose domain
  status and setup guidance through MCP; require explicit authorization for DNS
  changes. Verify Cloudflare's current custom-domain requirements before building.
- [ ] **Evaluate Cloudflare Monetization Gateway as an opt-in integration.** Keep
  Monetization off by default and independent of launching a site. Explore paid,
  read-only access to selected datasets, APIs and MCP data tools (Pananómica's
  economic and real-estate data is the initial use case). Separate paid data
  endpoints from the authenticated CMS editing MCP; preserve private research.
  Explain audiences, pricing, receiving wallet and payment verification, and expose
  configuration/status through MCP with explicit approval before enabling charges.
  Recheck eligibility before implementation: as checked on 2026-10-10, closed beta,
  US-based buyers and sellers, account older than 60 days, Cloudflare-proxied zone
  older than 30 days, plus account/security requirements. Do not promise immediate
  activation for a newly connected domain. Sources: [overview](https://developers.cloudflare.com/monetization-gateway/),
  [eligibility](https://developers.cloudflare.com/monetization-gateway/eligibility/),
  [setup](https://developers.cloudflare.com/monetization-gateway/get-started/).

## Longer-term: prove one complete thought workflow

- [ ] **Verify the real client path first.** On a disposable private tenant, prove
  the intended ChatGPT/Claude client can call connected tools in the intended
  conversation mode. Voice compatibility is unverified. Record exactly what reaches
  the tool: verbatim text, approved summary, attachment, or neither.
- [ ] **Implement private-repository checks.** Recheck actual onboarding creation
  and runtime visibility; documented private-by-default intent is not proof of
  enforcement. Refuse private-note operations on public repos. The product repo is public.
- [ ] **Define note files and save semantics.** Text, quotes and links first;
  stable IDs, sources, timestamps and separate origin labels. Use `notes/`, outside
  website collections and `public/`. Decide the branch strategy against Publish
  and Discard before wiring saves; see [Thoughts v1](thoughts-v1.md).
- [ ] **Implement save/read/find/develop tools.** Extend tenant MCP with confined
  paths, bounded retrieval, conflict detection and retry-safe creation. Tool names
  in the design are proposals, not shipped APIs.
- [ ] **Add a Thoughts workspace.** Browse/search/read notes, inspect contributions
  and sources, and make human edits. Keep website management available. No mandatory
  title, category or publishing date just to save a thought.
- [ ] **Develop selected material into writing.** Explicitly copy chosen material
  into an article/page draft; preserve the source. Publication remains the existing
  reviewed website workflow. No bulk exposure of underlying thinking.
- [ ] **Test privacy.** Public pages, feeds, sitemap/search, preview builds,
  `llms.txt`, `site-system.json`, assets and package output must not contain notes.
  Authenticated note retrieval is intentional and must preserve repository authorization.
- [ ] **Complete the real-assistant round trip.** Save, retrieve in another
  conversation, develop, review in CMS, publish a chosen derivative and verify the
  note stays private and survives website Discard.

## Earlier completed work

September publishing reconciliation, schema/page contracts, starter expansion,
brand preview and product-page migration are recorded in the
[September handoff](handoff-2026-09-07.md), [publishing contract](publishing.md)
and [October production review](admin-production-review-2026-10-10.md).
Historical test counts are evidence for those checkpoints, not today's baseline.

## Finish the current product pass

- [ ] Align homepage copy, SEO and CMS guides with conversation-first GitHub v1.
  Preserve the owner's latest English hero text (“Your website, your rules. Free,
  forever.”). Review remaining sections and translations with the agreed direction;
  do not replace approved copy or advertise the notebook as shipped.
- [ ] Simplify designed-page settings: remove irrelevant block/image/excerpt controls
  where the chosen template does not use them. Page blocks are already retired.
- [ ] Layout/template switching for installed designs remains open.
- [x] Implement the initial agent-built plugin contract: manifests, tenant server
  modules, declared settings, shared CMS/MCP operations and private Research with
  reviewable editor proposals. Verified locally, not deployed. See
  [Plugin API v1](plugins-v1.md) for the explicit extension limits.
- [ ] Improve content-type deletion discoverability. It works under Advanced
  settings → Remove content type, but the user could not find it. No subsequent
  visibility improvement was implemented.
- [ ] Browser-check sidebar, content types and header/footer, including narrow
  widths, language switching with unsaved edits and owner/editor navigation. Tests
  and builds passed; no browser pass was performed for these September 7 changes.

## Later

- [ ] Explicit note connections, cited retrieval and related-thought suggestions.
- [ ] Real resurfacing mechanism; no fake background memory or scheduled reminders.
- [ ] Private image/audio attachments when client transport is proven. Never use
  website public uploads for private notebook attachments.
- [ ] Search/index scaling; reconsider D1/R2 when file-based retrieval warrants it.
- [ ] Crawler analytics, separate from the notebook MVP. OAuth permissions were
  discussed, not changed. Ongoing analytics access must respect the no-broker-token
  invariant. Full raw HTTP logs are not the free-tier baseline.
- [ ] Optional licensing research much later, with separate explicit consent.

## Existing engineering backlog: verify before resuming

Historical details remain in [TODO history](todos-history.md). Recheck these areas
against code rather than asserting that every old finding remains open:

- Publishing paths outside the new CMS snapshot flow and reliable preview claims.
- Entry/schema/template validation, detail/list scopes and generated routes.
- Write atomicity, optimistic concurrency and transient-read retries.
- Third-party agent tests, media transport and safe uploads.
- Content-type routes/deletion, multilingual setup, relations, taxonomies,
  listing filters/pagination and galleries.
- True inline preview editing, body-region mapping and pending counts.
- Duplicated catalogs, inaccessible settings and decision-oriented review.
- [CMS findings](cms-review-todo.md), credential rotation in
  [keys and secrets](keys-and-secrets.md), and bot branch confinement.

Superseded TODOs include the zero-secret auth migration, “CMS redesign not started,”
missing page-template authoring guidance, and missing preview-to-field focus.

## Verification and release

```sh
npm test
npm --prefix admin run build
npm run check:site
node bin/lanza.mjs build
```

Site validation currently reports zero errors and warnings; the earlier header
scope errors are fixed, and validation runs during `lanza build`. For Functions/package
changes also compile Pages Functions and build a real tenant from the packed
package; monorepo success does not prove tenant imports work. Follow the Wrangler
skill before invoking Wrangler. See [release-plan.md](release-plan.md); archive
commands are not current authorization to publish. Preserve existing local edits.
