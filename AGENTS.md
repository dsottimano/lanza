# Repository instructions

Read `CLAUDE.md` and `docs/site-system.md` before changing this project. Preserve
existing local work. Read `docs/review-surface.md` before changing CMS previews.

## Resume and task scope

- Read `docs/todos.md` and its current handoff before resuming. The queue, delivery
  evidence and historical backlog serve different purposes; do not repeat completed
  migrations or treat old test counts as a current verification result.
- Active plugin integration is in `lanza` on `feat/plugins-cms`, based on
  `feat/agent-requests`. Retained local edits were reconciled; the pre-integration
  stash and external recovery copy remain available. Check actual status before editing.
- Keep general CMS behavior in shared Lanza source and tenant words/data in the
  tenant repository. A tenant workaround alone does not complete a product fix.
- Read the latest saved content and requests before editing; preserve the author's
  voice. Git authorship is not proof that prose was written by a human.
- Keep CMS actions and MCP capabilities/instructions aligned. Document unsupported
  operations and distinguish saved Git content from unsaved live-editor context.
- Saved requests do not start an assistant. Resolved, answered, accepted, saved and
  published are separate states; never report one as another.
- Private research/requests must stay outside public build output and website
  publication/discard flows. Read the security model before changing those paths.

## Delivery evidence

- Distinguish source implementation, tests, package release, Git push and deployment.
  Verify the intended branch/commit and actual URL before claiming a live fix.
- Fixing an installer does not migrate an already-installed tenant. Inspect actual
  entries, URL mappings and navigation; preserve displaced content and verify the
  user's existing site, including draft exclusion.
- When npm lifecycle scripts are disabled, explicitly rebuild CMS assets before
  packing. Verify the packed tenant, not only the source checkout.
- At handoff, update the current queue and record exact known checkpoints, remaining
  limitations and the next useful action. Do not store secrets or restart background
  services merely to prepare the next session.

## Mandatory schema contract

- `data/schema.json` is the content model. `admin/src/schema.ts` loads it; it is
  not a separate schema to edit. Generated content config and collection routes
  must never be hand-edited.
- Every public content page, including this product's marketing pages, must be
  editable through a declared CMS collection. Use `content/pages/<locale>/<id>.md`
  for one-off pages. Use `collection.route` for custom content types.
- Designed pages use `preset` plus `slots`. Declare the editable fields once in
  `templates/<preset>/fields.json`; store words, images and links in the entry.
  Keep presentation in the template. Never put page copy in Astro or TypeScript
  constants, invent fixed marketing routes, or hide a CMS entry behind a route.
- Do not add the retired top-level page `blocks` field or use the legacy block
  renderer for new work. Reuse section markup and field declarations inside a
  page preset; the result still has one `fields.json` and one set of entry slots.
  Saved snippets are rich-text insertion shortcuts, not page layouts.
- Keep translation filenames linked, respect `data/site.json` URL mappings, and
  preserve draft visibility. A draft or moved page must not reveal fallback copy.
- System routes (404, taxonomy archives, discovery endpoints, style preview, and
  the generic empty-site/blog fallback) are infrastructure, not a way to add
  public editorial pages. Change their scope only with a documented reason.
- Before handoff run `npm run check:site`, relevant regression tests, and
  `node bin/lanza.mjs build`. An error is a blocker, not optional advice. Report
  remaining warnings and unverified browser/deployment work honestly.
- For each new page, verify its CMS entry, declared fields, public route and
  locale; change an editable value and confirm the renderer uses it. Include its
  CMS location in the handoff. Do not claim deployment from a successful build.

## Publishing alongside CMS edits

- Before editing or pushing, fetch and inspect BOTH `origin/main` and
  `origin/staging`. The CMS writes staging; a clean local main is not proof that
  there is no human work. Never resolve a content conflict by taking all of main.
- Compose changes with the latest drafts. When a template/field shape changes,
  explicitly migrate the human's edited values into the new fields and verify the
  render. Preserve legal/body content when changing templates.
- Before pushing main, merge main into staging, reconcile conflicts, validate the
  combined tree, then publish that reconciled commit. If staging changes again,
  fetch and reconcile again. Never reset or force-push over draft edits.
- Enable the checked-in guard with `git config core.hooksPath .githooks` when no
  other hooks path is configured. It checks the live remote staging tip before
  a main push and refuses to strand CMS work. Do not bypass it with `--no-verify`.
  This is a local guard, not server-side branch protection.
