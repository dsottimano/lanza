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
