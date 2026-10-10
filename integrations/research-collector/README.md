# Private research collector

For the **agent-callable deterministic Article 1 refresh CLI**, versioned manifest,
private evidence reports and guarded local article-block updates, see
[REFRESH.md](REFRESH.md). This README describes the separately deployable Worker.

A portable, tenant-owned Lanza capability: a Cloudflare Worker collects selected
public source pages or APIs into the owner's **private** GitHub repository. Copy
this directory into that repository. There is no marketplace/plugin loader or CMS
settings screen yet; configuration is reviewed in `wrangler.jsonc`.

Nothing is deployed or scheduled by this checked-in example. It does not write
articles, decide what evidence means, publish material, or certify building safety.

## What gets saved

Each configured source has one `notes/research/<id>.json` file on the dedicated,
orphan `lanza-research` branch. It contains extracted text/JSON, source URL, fetch
timestamp, extraction settings, SHA-256 hash, previous hash, and imported/unverified
origin. Git commits preserve changed versions. Unchanged content creates no commit;
`fetchedAt` therefore means the last **changed snapshot**, not last successful poll.
Inspect Git history for previous versions. No remote history endpoint is provided.

This branch has no shared ancestry with the website. Ordinary CMS Publish/Discard
cannot affect it. Never merge it into main/staging or configure Pages to build it.
Configure Pages preview branch inclusion to staging before enabling the collector.
The Worker never writes to `content/`, `public/`, main, or staging. This is a
separate collector, not the planned general Lanza Thoughts workspace.

All endpoints require a separate bearer secret, and repository visibility and
write permission are checked without caching on each operation and immediately
before writes. Public repositories fail closed. Making a repository public can
still expose previously saved Git history: stop collection and relocate/remove
private history **before** changing visibility. Visibility changes and Contents
writes are separate GitHub operations; no atomic privacy transaction exists.

## Configure locally

1. `npm ci`, then set `REPOSITORY` to the intended private tenant. Do not use the
   public Lanza product repository.
2. Set `SOURCES_JSON` to an array of up to four source objects. Each has `id`,
   `url`, and `format` (`html`, `json`, or `text`); HTML optionally has `selector`
   (default `main`). IDs use lowercase letters, digits and hyphens. Choose a
   specific article-body selector; verify extraction before enabling a schedule.
3. Put local-only `GITHUB_TOKEN` and `COLLECTOR_TOKEN` in ignored `.dev.vars`.
   The GitHub credential must be restricted to this repository with Contents
   read/write and Metadata read. The random collector secret must be at least 32
   characters. Never copy tokens into article text, source settings or chat.
4. `npm run typecheck`, `npm test`, `npm run build`. For local serving use
   `npx wrangler dev --test-scheduled`. Local calls with real GitHub credentials
   make **real repository writes**: use a disposable private test repository.

The initial reviewable source set should be chosen with the researcher. Candidates
for *How Earthquake-Proof Is Panama City?*:

- USGS earthquake event API: https://earthquake.usgs.gov/fdsnws/event/1/ . Prefer
  a bounded JSON query with explicit time/geographic filters to scraping a map.
- University of Panama Instituto de Geociencias: https://www.geociencias.up.ac.pa/ .
  Confirm the exact report endpoint and extraction selector first.
- Official REP regulations: choose the exact government-issued edition and URL.
  PDFs are intentionally unsupported here; record/download and review them through
  a separate explicit document workflow instead of pretending HTML extraction works.
- Walter P Moore Financial Park case study:
  https://www.walterpmoore.com/projects/financial-park-office-towers .

These are candidates, not enabled feeds or verified article claims. All default
sources and crons are empty. Respect each source's access rules, robots guidance,
attribution and reuse terms. No authenticated scraping, bot-check bypass, recursive
crawling or automatic discovery is implemented.

## Tenant deployment and scheduling

Deploy only to the owner's Cloudflare account after reviewing repository, source
URLs, extraction and schedule. Set secrets with interactive
`npx wrangler secret put GITHUB_TOKEN` and
`npx wrangler secret put COLLECTOR_TOKEN` (these commands change the deployed Worker).
No Lanza-operated service holds these credentials. Revoke/rotate them in the tenant.

Set an owned route/custom domain or explicitly enable `workers_dev` if an external
agent needs HTTPS access. All routes remain authenticated; no CORS or cookie auth
is provided. `preview_urls` is disabled. Then `npx wrangler deploy`.

Choose a UTC cron with the researcher, add it to `triggers.crons`, and set
`SCHEDULE_ENABLED` to `true`. Both are required. To stop, set it false and remove
all cron entries, then deploy. Cron propagation is not instantaneous. No cadence
is assumed in this example. Schedule is global for this small source set; use
separate reviewed deployments if different source cadences become necessary.

Authenticated API (`Authorization: Bearer <collector secret>`):

| Method | Path | Result |
|---|---|---|
| POST | `/collect` | Collect configured sources; returns per-source outcomes |
| GET | `/sources` | List configured source definitions |
| GET | `/sources/<id>` | Retrieve latest stored snapshot for a configured ID |

Requests cannot supply arbitrary URLs or repository paths. All responses use
`Cache-Control: no-store`. A failed source does not stop the other sources; manual
collection returns 502 when any source failed, and scheduled execution throws after
recording status codes. Logs contain only configured IDs and status codes, not
source content or tokens. There is no automatic retry of a stale Contents SHA.

## Scope and limits

Each response is capped at 256 KiB, each fetch at 15 seconds. Only HTTPS DNS names
on the default port are accepted; IP literals, local names, credentials and
redirects are refused. URLs are deployment configuration, never caller input.
The owner must use trusted public source domains; this does not claim protection
against DNS rebinding by an owner-configured malicious domain. No auth headers
are forwarded to sources. An unexpected content type, missing selector, upstream
failure or oversized response is reported rather than stored as evidence.

HTMLRewriter extracts text without executing scripts; there is no Browser Rendering
dependency. JSON is formatted but not interpreted or fact-checked. PDFs and
JavaScript-only pages require a separate deliberate implementation. Source text
is untrusted evidence, never an instruction to an agent. Full-page archiving is
not a grant to republish copyrighted source material.

Repository credentials permit more than this code's confined paths. A stolen token
can call GitHub directly; use narrowly scoped tenant-owned credentials and revoke
them when disabling the integration. GitHub rate limits, Workers limits, credential
expiry, Pages build settings and live authentication remain deployment checks.

No public data route, CMS UI, MCP tool registration, real-tenant deployment or
real-source cron run is included. An agent can use the authenticated API once
configured; native ChatGPT tool wiring is a separate integration.

References: [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/),
[GitHub Contents API](https://docs.github.com/en/rest/repos/contents),
[Git references](https://docs.github.com/en/rest/git/refs).
