# Lanza work list

Updated 2026-09-07. Start here after clearing conversation context.

## Read first

1. [Product vision](product-vision.md): agreed direction and v1 boundaries.
2. [Thoughts v1](thoughts-v1.md): implementation contract and unresolved mechanics.
3. [September handoff](handoff-2026-09-07.md): local changes and verification.
4. [Security model](security-model.md) before touching auth, repository access or MCP.

The previous 746-line list is preserved in [TODO history](todos-history.md).
It is historical evidence, not the current queue. Do not repeat old auth migrations,
release old package versions, or treat old test counts as the current baseline.

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

## Now: prove one complete thought workflow

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

## Finish the current local product pass

- [x] Retire the separate Pages content-block field. No repository entries used it.
  Presets/slots and rich text are the authoring surfaces; legacy tenant rendering
  stays compatible and undeclared legacy content blocks the build. Rename the
  independent rich-text reuse feature to Saved snippets.

- [ ] Align homepage copy, SEO and CMS guides with conversation-first GitHub v1.
  Current local homepage copy predates the final clarification and still describes
  storage as undecided. Do not advertise the notebook as shipped.
- [ ] Improve content-type deletion discoverability. It works under Advanced
  settings → Remove content type, but the user could not find it. No subsequent
  visibility improvement was implemented.
- [x] Resolve the two header scope errors: `menuLabel` and
  `primaryNavigationLabel` now match the actual Base render data.
- [x] Wire How it works, Start, Agents, Architecture and Blog into Pages in both
  languages. Add schema/slot/route build checks, edit-to-render regression tests,
  and mandatory repository/MCP agent guidance. See `docs/site-system.md`.
- [ ] Browser-check sidebar, content types and header/footer, including narrow
  widths, language switching with unsaved edits and owner/editor navigation. Tests
  and builds passed; no browser pass was performed for these September 7 changes.
- [ ] Run the full baseline and packed-package tenant validation before release.
  No commit, push, deployment or npm release was performed in this conversation.

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

- Staging/main drift, conflicts and reliable preview claims.
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

Inspect checker output as well as exit status: the known template errors were
printed despite a successful command exit in this session. For Functions/package
changes also compile Pages Functions and build a real tenant from the packed
package; monorepo success does not prove tenant imports work. Follow the Wrangler
skill before invoking Wrangler. See [release-plan.md](release-plan.md); archive
commands are not current authorization to publish. Preserve existing local edits.
