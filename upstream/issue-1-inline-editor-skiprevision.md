# Bug: inline visual editor creates a new revision on every field-blur (`skipRevision` not sent)

**Affected version:** emdash 0.16.1
**Component:** `emdash` core — visual-editing toolbar + content update path

## Summary

The inline visual-editing toolbar (the floating *Edit · Publish* bar on the public site) saves on every field blur and **does not send `skipRevision`**. Core's update path therefore inserts a brand-new row in the `revisions` table on every save. A single editing session — clicking through a few fields, a few edits each — balloons into dozens of revision rows.

The full admin dashboard editor does not have this problem: it sends `skipRevision: true` on autosave, so its autosaves update the existing draft revision in place.

## Steps to reproduce

1. Open any published page on the public site with the inline editor in Edit mode.
2. Edit a field, click out (blur). Edit another field, click out. Repeat a few times.
3. Inspect the `revisions` table for that entry (or the admin Revisions panel).

**Expected:** one draft revision per editing session (subsequent autosaves coalesce into it).
**Actual:** one new revision row per field-blur — e.g. 18 rows from a single session.

## Root cause

The toolbar's `saveField` PUTs a bare body:

```js
// emdash/src/visual-editing/toolbar.ts  (saveField)
ecFetch("/_emdash/api/content/" + collection + "/" + id, {
  method: "PUT",
  body: JSON.stringify({ data: { [field]: value } }),   // no skipRevision
});
```

Core already supports coalescing — it just isn't asked to:

```js
// emdash/src/emdash-runtime.ts  (handleContentUpdate, draft-revision write)
if (body.skipRevision && existing.draftRevisionId) {
  await revisionRepo.updateData(existing.draftRevisionId, mergedData);  // in place
} else {
  await revisionRepo.create({ ... });  // NEW row — taken on every inline save
}
```

The request body schema already accepts the field (`emdash/src/api/schemas/content.ts` → `skipRevision: z.boolean().optional()`), and the admin editor already sends it.

## Suggested fix

Have the visual-editing toolbar send `skipRevision: true` on its blur-driven autosaves, matching the admin editor. (Optionally expose an explicit "save as new revision" affordance if a discrete checkpoint is ever wanted from the inline editor.)

## Workaround (no core changes)

Astro middleware in the host app defaults the absent flag before the request reaches the API route. Because the key is only filled when absent, the admin editor's explicit value is never overridden:

```ts
// src/middleware.ts
if (request.method === "PUT" && /^\/_emdash\/api\/content\/[^/]+\/[^/]+$/.test(path)) {
  const body = await request.clone().json();
  if (body?.skipRevision === undefined) body.skipRevision = true;
  // ...reconstruct Request with the new body...
}
```

Verified: three inline-style PUTs produce **1** coalesced revision with the workaround vs **3** appended rows without it.
