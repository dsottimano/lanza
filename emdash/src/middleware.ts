import { defineMiddleware } from "astro:middleware";

/**
 * Coalesce inline visual-editor autosaves into a single draft revision and
 * backfill the revision author.
 *
 * Why: emdash's inline visual-editing toolbar PUTs `{ data: {...} }` to
 * `/_emdash/api/content/:collection/:id` on every field-blur, omitting
 * `skipRevision`. Core therefore inserts a brand-new revision row per blur,
 * so one editing session balloons into dozens of revisions, none attributed
 * to a user. The full admin editor avoids this by sending `skipRevision: true`
 * on autosave.
 *
 * Fix (no core changes): default the absent flag to `true` so inline saves
 * update the existing draft revision in place, and backfill `authorId` from
 * the session. Because we only fill when the key is ABSENT, the admin
 * editor's explicit choice is never overridden.
 *
 * Verified empirically: 3 inline-style PUTs produce 1 coalesced revision
 * (vs. 3 without this) and the revision carries the session user's id.
 *
 * Remove once upstream fixes are released:
 *   - inline toolbar should send `skipRevision` like the admin editor
 *   - revision author should derive from the session server-side
 */
const CONTENT_ITEM_PUT = /^\/_emdash\/api\/content\/[^/]+\/[^/]+$/;

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, locals } = context;

  if (
    request.method === "PUT" &&
    CONTENT_ITEM_PUT.test(new URL(request.url).pathname)
  ) {
    try {
      const body = await request.clone().json();

      if (body && typeof body === "object") {
        let changed = false;
        if (body.skipRevision === undefined) {
          body.skipRevision = true;
          changed = true;
        }
        const userId = (locals as { user?: { id?: string } }).user?.id;
        if (body.authorId === undefined && userId) {
          body.authorId = userId;
          changed = true;
        }

        if (changed) {
          context.request = new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(body),
          });
        }
      }
    } catch {
      // Non-JSON or unreadable body: leave the request untouched.
    }
  }

  return next();
});
