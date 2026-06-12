# Discussion: reverting a revision appends a new revision instead of restoring a pointer

**Affected version:** emdash 0.16.1
**Component:** `emdash` core — revisions / revert behavior

## Observation

In the Revisions panel, clicking the revert (↶) arrow on an older revision rolls the content back by **writing a new revision** rather than moving the draft pointer to the chosen one. Combined with [the per-blur revision bug](./issue-1-inline-editor-skiprevision.md), revision history grows quickly, and "revert" itself adds to the pile.

Core does bound this — `pruneOldRevisions(collection, id, 50)` caps retained history at 50 per entry (`emdash/src/emdash-runtime.ts`) — so it isn't unbounded, but the panel can still feel cluttered and the mental model is surprising.

## Questions for maintainers

1. **Is revert-as-new-revision intentional** (an audit-friendly "never lose history" stance), or worth offering a "restore this revision" that re-points the draft without appending?
2. Should the **revisions panel deduplicate or collapse** near-identical consecutive autosaves for display, independent of what's stored?
3. Is the **50-entry prune cap** configurable per collection? For high-edit content it may be worth lowering; for audit-heavy content, raising.

## Context

This came out of a real migration (definemg → EmDash). A single homepage editing session produced 18 revisions, all unattributed (see the two linked bugs). After fixing autosave coalescing and authorship via host middleware, the remaining rough edge is the revert model — hence a discussion rather than a bug.

## Not a bug report

Filing as a discussion because the current behavior is defensible; the goal is to align on the intended UX before proposing a change.
