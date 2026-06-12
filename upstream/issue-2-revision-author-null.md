# Bug: visual-editor saves store revisions with `author_id = NULL` (revision author not derived from session)

**Affected version:** emdash 0.16.1
**Component:** `emdash` core — content update path / PUT route

## Summary

Revisions created through the inline visual editor are stored with `author_id = NULL`. The revision author is taken only from the request body's `authorId`, which the inline toolbar never sends, and the PUT route does not fall back to the authenticated session user for the *revision* author. Result: revision history shows no "who" for inline edits.

## Steps to reproduce

1. Log in and edit a published page via the inline visual editor.
2. Inspect the resulting rows in the `revisions` table.

**Expected:** `author_id` = the editing user.
**Actual:** `author_id` is `NULL`.

## Root cause

The draft-revision write passes the author straight through from the body, defaulting to `undefined`/null:

```js
// emdash/src/emdash-runtime.ts  (handleContentUpdate)
await revisionRepo.create({
  collection, entryId: resolvedId, data: mergedData,
  authorId: bodyWithoutRev.authorId ?? undefined,   // body has no authorId → null
});
```

The PUT route resolves `locals.user` for permission checks but only forwards `body.authorId` (and strips it unless the caller has `content:edit_any`); it never derives the revision author from the session:

```ts
// emdash/src/astro/routes/api/content/[collection]/[id].ts (PUT)
const { user } = locals;            // authenticated user is known here
// ...
const updateBody = canChangeAuthor ? body : { ...body, authorId: undefined };
```

The toolbar's `saveField` body is `{ data: { [field]: value } }` — no `authorId`.

## Suggested fix

When creating a revision, default its `authorId` to the authenticated session user (`locals.user.id`) if the body doesn't specify one. This is distinct from the content item's `authorId` (which is permission-gated) — the *revision* author is simply "who made this edit" and should come from the session.

## Workaround (no core changes)

The same host-app middleware that fixes the `skipRevision` issue backfills `authorId` from `locals.user` when absent. EmDash registers its auth middleware with `order: "pre"`, so `locals.user` is already populated when the host middleware runs.

Verified: with the workaround, inline-edit revisions carry the session user's id instead of `NULL`.
