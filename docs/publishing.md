# Publishing and CMS branch reconciliation

Updated 2026-09-07. The CMS reads and writes `staging`; production builds from `main`.
This document describes the current CMS and repository workflow. MCP publishing
still uses its older implementation; see the open work below.

## September 7 incident

An agent pushed a homepage redesign to main without incorporating the owner's
pending CMS edits on staging. The redesign changed the page preset from `manifesto`
to `editorial`, with different field names. Meanwhile, the owner edited the old
preset's `tag`, `headline`, and `sub` fields. Git could not reconcile the competing
homepage changes and returned HTTP 409 when the CMS attempted to publish.

The error dialog hid the useful recovery text: `reportError` preferred the API's
short “Merge conflict” message over the supplied explanation. Separately, the
sidebar's Publish site label opened a review screen, whose Publish to production
button performed the write. Those were two different steps with misleading labels;
there was no reproduced need to click the final publish button twice.

The repair merged production into staging while preserving the owner's exact
headline and introduction in the new template's fields. The legal page had selected
Manifesto with empty slots, hiding its body; its normal text layout was restored.
The built HTML was checked for the owner's exact words and the legal body.

Code and reconciled content were pushed atomically to both branches at `7239901`.
The first code/content commit was `1bfafeb`; the publishing safeguards are in
`4f9d928`. A push starts deployment; it does not prove the deployment completed.

## What the CMS now does

1. **Review & publish** in the sidebar opens the review. **Publish site** on that
   screen is the action. One click starts one request; duplicate clicks are disabled
   while it runs.
2. The review captures both branch commit IDs and compares those immutable commits.
   A failed load disables publishing and does not claim there are no changes.
3. If both branches changed independently, publishing is paused. **Update drafts**
   merges the reviewed production commit into staging without publishing. A conflict
   stops without overwriting either branch and shows recovery instructions inline.
4. After updating drafts, the owner reviews the combined changes before publishing.
5. Publish verifies that both branch tips still match the review. If either changed,
   it requires a new review. It publishes the reviewed staging SHA with a
   fast-forward-only ref update (`force:false`).
6. GitHub also enforces that fast-forward at write time. Production changes arriving
   after preflight cannot be overwritten. Draft changes arriving after preflight are
   not included: the request targets a commit, not the moving staging branch.

The implementation is in `admin/src/backend/github.ts` and `PublishView.vue`.
Tests cover immutable review/publish targets, stale tips, a production race after
preflight, duplicate clicks, divergence, conflict handling, and failed refreshes.

## Repository-agent workflow

Before work, fetch both branches and inspect pending CMS changes. Implement against
those drafts, especially when changing a template or field names. Do not take all
of main to resolve a content conflict. Translate the owner's changed values into the
new schema deliberately, then check both the CMS fields and the public render.

Reconcile main into staging, validate the combined tree, and publish that reconciled
commit. Use normal merges and fast-forward pushes. If new draft commits arrive,
fetch and reconcile again. Never reset staging or force-push to make a conflict go
away. An atomic push of the same reconciled commit to main and staging keeps both
aligned and rejects the operation if an intervening draft prevents a fast-forward.

This checkout enables `.githooks/pre-push` through `core.hooksPath`. The guard fetches
the live remote staging tip before a main push and refuses if the proposed commit
does not contain it. New checkouts must enable it explicitly:

```sh
git config core.hooksPath .githooks
```

Inspect an existing hooks configuration before replacing it. Never bypass the guard
with `--no-verify`. It is a local safeguard, not GitHub branch protection: other
checkouts, APIs, and edits after its final fetch are outside its enforcement.

## Remaining work and limits

- Give MCP publishing the same reviewed-commit contract; its separate client still
  merges a moving staging branch into main.
- Browser-verify the deployed review/update/publish flow and error recovery, including
  narrow screens and two concurrently open editors. Unit tests are not a browser test.
- A successful branch update is not deployment completion. Surface deployment status
  in the CMS instead of implying that the new site is already live.
- Consider server-side repository rules for writers that do not use the local hook.
  No branch-protection policy was changed in this repair.
- Reconciliation cannot automatically decide between contradictory human and agent
  edits. Stop with preserved content and an actionable explanation in those cases.
