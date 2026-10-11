# Highlighted-text request delivery — 2026-10-10

Delivered to https://pananomica-95335bfcac19.pages.dev/admin/.

## Shipped behavior

Owners of private repositories can select article text and choose Ask AI, Verify,
Find source, Rewrite or Explain visually. Requests capture the exact quote, context,
positions and full-body SHA256. Requests and assistant replies persist on the
independent private `lanza-agent-requests` branch. MCP lists, reads and responds.
Submission does not invoke an assistant or notify an existing chat. The user asks
their connected assistant to check requests; the open panel polls for responses.
Review & apply validates the captured body/selection and the proposed TipTap HTML,
asks for acceptance, then applies locally and pauses autosave until explicit Save.
No request operation publishes. Existing Delete post and publishing-control fixes
are included. Source branch: `feat/agent-requests`.

## Actual deployment and retained drafts

- Production deployment: `038b3d9b-744b-4110-a504-eb1374136da1`, verified canonical,
  successful production deployment after the live browser check.
- Deployment source receipt: tenant `release/agent-requests` commit
  `4ab1b268d080c24e0da444e2ebcee78648e176ac`.
- Public content remains from `aed7255dd8a8b9d2f7c97a241a6e2c000e113c50`.
- Software: private packed `lanza-site` 0.1.19, source
  `925a8e45df53ba7181a3bca0f1e20246c14b9d79`.
- Package SHA256: `5adef33002369b46d9de127737b9207c9daa3464b55121f9f16cc986567c6f89`.
- Tenant staging `2a4f29e` preserves all prior editorial content byte-for-byte;
  only package.json and `.lanza/packages/` differ from its prior `c9e8b2e`.
- npm publication was refused with EOTP. No new npm version or tag was published.
  The verified tarball and provenance are in the private tenant with a relative
  file dependency, so ordinary subsequent site builds need no npm approval.
- Main's Git dependency pin remains 0.1.16 until reviewed publication. An automatic
  production Git build before that can revert the software; the working artifact
  deployment is retained and the exact package upgrade is staged. No draft merge,
  force push, or hook bypass was used.
- Cloudflare preview controls preserve ordinary branch builds and explicitly
  exclude `lanza-agent-requests` and `lanza-research`; request commits also skip CI.

## Verification

465 Functions/script tests, 618 CMS tests, 20 OAuth tests, and two additional real
Workers runtime regressions passed. Site validation: zero errors/warnings.
CMS typecheck/build, public build, packed production and staging tenant builds, and
legacy Wrangler 3.114.17 Pages Functions compilation passed.

The live Chrome round trip selected the actual Article1 paragraph, saved its exact
quote, responded through the deployed MCP endpoint, opened the human review,
cancelled without changing editor HTML, resolved the request and reloaded to prove
persistence. Zero browser page errors. Both agent-created synthetic diagnostics
were then removed; no human request or article was changed.

Unauthenticated request API returns401; private request JSON, private software
artifact and unpublished article URLs return404. Archive storage is outside all
website publication/discard branches and public build output.

Live validation caught and fixed two Node/mock versus deployed-runtime differences:
GitHub rejects a trailing slash on repository metadata URLs, and Workers rejects
`redirect: "error"`. Metadata URLs are canonical; manual redirects remain refused
by the existing non-2xx check. Tests pin both behaviors, including native Workers
Request construction and refusal to follow302.

Warnings retained: empty taxonomy collections and existing large public JS chunk;
Wrangler invoked from the sibling installation warns about its root Astro tsconfig.
Functions compilation, deployment and actual browser/MCP behavior succeeded.
Actual ChatGPT.com installation/automatic wake-up and a deployed research cron
remain outside this feature; do not advertise them as verified.

## Selection-menu visibility follow-up

Delivered private package0.1.20 (tenant rollout `bdabae1`, staging `2f7c158`) at
`https://e5504d9f.pananomica-95335bfcac19.pages.dev`. The menu is anchored12px
below the highlighted range, follows captured scroll/resize events, stays within
the viewport and flips above when necessary. Dark navy surface, white text,44px
buttons and stronger shadow make the actions prominent.

Ten relevant request/editor regressions, CMS typecheck/build, site validation and
source/packed-tenant builds passed. Real Chrome on the production origin confirmed
desktop placement, scrolling,390px mobile containment, exact passage capture and
Cancel without modifying the article. No browser errors or write attempts. Existing
build warnings and the private-package/reviewed-publication workflow above remain.

## Clipboard image upload follow-up

Private package 0.1.21 (source `0297fcf`, tenant rollout `e48ba43`, staging
`fa466e0`) adds Ctrl/Cmd+V image upload at the cursor or into a focused empty
image block. Clipboard files receive unique names, upload through the existing
staging media client, and display a local preview immediately. Completion follows
the original figure through edits; deleted figures are not resurrected. Transient
preview/upload attributes never serialize into article HTML. Errors leave a
retryable placeholder. PNG/JPEG/GIF/WebP/AVIF are supported, maximum 10 files per
paste and 20 MB each. Ordinary text paste remains native.

Production deployment `288e6804-7869-4825-b883-7b6ab34aeac0` is confirmed canonical
and successful. Public content is the latest published `326f916`; software-only
staging changes preserve all editorial files from `9529e19` byte-for-byte. The
first upload attached to an in-progress Git preview for the same commit; repeating
after that finished created the intended ad-hoc production deployment.

26 relevant regression tests passed, including asynchronous cursor edits, deletion,
retry, multiple images, serialization and undo/redo. CMS typecheck/build, site
validation and source/production/staging builds passed. Real Chrome clipboard
pasting of the user's supplied PNG map filled the existing empty image block and
showed a decoded image, both before rollout and on production. Browser upload
writes were intercepted with successful fixtures and all other mutations blocked:
this verifies the actual clipboard/UI/upload payload without changing the user's
article or uploading test media. Existing media backend regressions cover shared
upload handling. Zero browser page errors. Build warnings remain the empty
collections, large public chunk, and sibling Wrangler Astro tsconfig warning.

## Image controls follow-up

Package 0.1.22 (source `42e70a5`, rollout `dca87d0`) adds visible Paste image and
Remove image controls, keyboard deletion on focused empty images, a focus ring,
and editor focus after removal so Undo works. Paste image uses the browser's
clipboard permission and gives an actionable fallback to Ctrl/Cmd+V if denied.
The reported screenshot lacked the new paste hint and showed the older UI; a
fresh production session passed clipboard testing before and after this fix.

Production deployment `c1cbc537` was verified through the canonical deployment
API and real Chrome. This time the browser made an actual successful staging
image upload through the authenticated CMS proxy, using the supplied map; it
also verified image decoding, filling the existing block, removal and undo.
Article PUT requests were blocked during this check, preserving the human's
writing. The uploaded test map remains a staged media asset. No article was
published. Software updates were rebased onto intervening human staging edits.

26 relevant regressions, CMS typecheck/build, check:site, source build, and packed
production/staging builds passed. Previously documented build warnings remain.

## Language switching and MCP translations

Package 0.1.23 (source `daebab3`, rollout `4dd504b`, staging `b8d0510`) is live at
production deployment `bce7f7ea-4d2d-4023-b588-600745dfc544`, confirmed canonical.
The writing canvas now exposes enabled language tabs above the title. Missing
versions offer Start blank or Ask AI to translate. The latter saves pending source
edits and prepares a private agent request; it does not invoke an LLM or wake a
conversation. Existing translations open directly. Other-language buttons wait
for existence lookup, avoiding navigation to a nonexistent entry during loading.

MCP exposes list_translations and create_translation; read_content returns SHA.
Creation uses supplied translated prose, shares the filename, preserves omitted
metadata/template/list structure/schema image assets, forces draft:true and refuses
existing targets or stale source revisions. Instructions and help describe the
agent-driven workflow and human publication. The source SHA recheck is not atomic
with another file's create. OAuth scope mappings and tests were updated in source;
the separate OAuth Worker was not deployed by this change. The tenant bearer MCP
endpoint was verified live: both tools are listed and Article 1 reports English
present, Spanish absent. No translation was created as an incidental test.

471 Functions/script tests, 627 CMS tests and 22 OAuth tests passed, as did CMS
and OAuth typechecks, sitecheck, source and packed production/staging builds, and
legacy Pages Functions compilation. Real production Chrome confirmed the visible
language tabs, Spanish translation request instructions and cancellation without
article mutation. Existing empty-collection, public bundle-size and sibling
Wrangler tsconfig warnings remain. Latest human staging content was preserved.
