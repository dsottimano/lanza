# Site-owned plugins, API v1

Implemented locally on `feat/plugins-cms`. This is source and package integration,
not a deployment receipt. Administration → Plugins lists installed capabilities;
Research is the first private workspace. Browser features remain in Brand & themes
and retain their staging/publication behavior.

## Ownership and trust

An agent authors reviewed source in the tenant's `plugins/<id>/` folder. There is
no marketplace, remote executable loader or installation through MCP. The build
registers code; enabling does not download anything. Plugin modules are trusted
application code, not sandboxed code. A permissions declaration is not a sandbox.
The shared runtime checks the repository's actual owner permissions and privacy on
every private operation and before writes. Credentials stay on the tenant server.

## Manifest and authoring

Every folder has `plugin.json`:

```json
{
  "apiVersion": 1,
  "id": "source-check",
  "name": "Source check",
  "version": "1.0.0",
  "description": "A private capability built for this site.",
  "scope": "private",
  "runtime": "request",
  "role": "owner",
  "workspace": "settings",
  "settings": [{ "key": "label", "label": "Label", "type": "string", "default": "My sources" }],
  "operations": ["check"]
}
```

The module `server.mjs` exports a default async function:

```js
export default async function run({ operation, input, state, repository }) {
  if (operation !== 'check') throw new Error('Unsupported action');
  return { state: { ...state, data: { lastChecked: new Date().toISOString() } },
    result: { message: `Checked ${state.settings.label || repository}.` } };
}
```

The context also has `assertEntry(path)` and `readEntry(path)`; validate an entry
before reading it. No token is supplied. The handler returns `{state,result}` for
a private write, or `{result}` for a read-only response. Shared operations are
`read`, `set-enabled`, and `settings`. Custom operations must be declared. Settings
support bounded strings, finite numbers and booleans. Generic CMS action buttons
use saved settings; richer inputs can come through MCP. Research has a dedicated
shared CMS workspace. Custom Vue components and new public browser adapters are
not part of API v1; those require a shared CMS/renderer change.

`node scripts/build-plugins.mjs` validates manifests and generates static imports.
`lanza build` does this before building and again after copying shared Functions,
so an update cannot replace the registry with the package's default registry.
Duplicate IDs, incompatible API versions, unsupported adapters and symlinked
plugin entrypoints fail the build. Tenant source folders are not overwritten.
Shared built-ins ship with the package; their IDs cannot be overridden by tenants.

## Data and lifecycle

Private plugins start disabled. Settings and data share one versioned, SHA-checked
state file, `plugins/<id>/state.json`, on an orphan `lanza-plugin-<id>` branch.
Research uses `lanza-research`, preserving the collector's existing branch identity.
The original collector's `notes/research/` snapshots are left intact; they are not
silently imported into the new state file. Git history retains prior plugin states.
There is no revision browser yet. Limit: 512 KiB of serialized current state.

The branch must never be merged into website main/staging. Restrict Pages preview
builds to website branches when configuring the tenant. Runtime data is never
placed in website collections, public assets or npm package inputs. Public repo
access is refused; making a formerly private repo public can expose prior Git
history, so disabling alone is not a privacy migration.

Enable/disable takes effect for subsequent request operations without publishing
website content. An in-flight fetch may finish, but its save is refused after a
concurrent disable or configuration change. Disabling retains data. Removing a
plugin's source removes it from the next built registry and retains its archive.
Deleting private history is a separate deliberate operation, not an uninstall side
effect. Unknown state versions fail closed; data migrations require explicit code
and review. API v1 has no automatic migration runner or scheduling runtime.

## CMS and MCP

`GET /admin/api/plugins` lists manifests; `GET ?id=<id>` reads private state.
`POST` takes `{id, operation, input}`. Cookie writes require exact same-origin
requests; bodies are bounded. MCP exposes `list_plugins` and `run_plugin` through
the existing owner-only transport. Both call `PluginRuntime`.

After `read`, pass its `sha` as `input.expectedSha` for every other operation;
initial setup uses `null`. Conflicts require reloading/reviewing, never overwriting.
Private settings do not enter website Review & publish or Discard. Website features
continue using `data/appearance.json` and the normal staged publishing flow.

## Research v1

One configured article per site, up to five HTTPS sources and 40 facts. In Plugins:
select Research, choose an existing post, add sources, save privately, enable, and
Refresh now. Page/text sources are monitored; JSON pointers and calculations supply
deterministic facts. The CMS edits simple pointers; agents can set the full reviewed
manifest through `configure`. Sources and fact definitions remain in private state.

The refresh engine is shared with the Node CLI. It preserves old evidence with
stale status when sources fail, preserves original fact provenance when extraction
fails, and prevents changed source definitions from borrowing old snapshots. A run
stores extracted source text, raw-byte hashes, dates, facts and before/after values.
Raw response bytes remain a CLI feature; the CMS stores extracted snapshots only.
Fetches are bounded (256 KiB response, 48 KiB extracted text, 10 seconds each),
redirects are refused, and credentials are never sent to sources. Runtime fetches
use approved manifest URLs, never an arbitrary URL supplied to `refresh`. Trusted
public domains are required; URL checks do not provide a DNS rebinding sandbox.

`propose` requires matching configuration and current sources/facts. It returns
escaped fact HTML and citations; it does not write an article. In the article,
Review research facts replaces the current selection or appends a facts section if
nothing is selected. The existing before/after modal validates supported HTML,
checks for changed research/editor state, and applies one undoable transaction.
Acceptance pauses autosave; Save and Review & publish remain separate actions.

There are no LLM calls, automatic factual conclusions, background assistant
invocation, cron activation, PDF extraction or regex extraction in this server
path. The standalone collector Worker remains a separate optional archive and
its cron does not call this plugin refresh. Its existing deployment is not managed
by the plugin's disable switch. The UI explicitly reports scheduling as unsupported.
The Node CLI still supports its existing PDF/regex workflow from the source checkout;
its shared engine now lives in `functions/_lib/research-evidence.mjs` and must accompany
it if copied outside this checkout.

## Validation

Backend regressions cover privacy/role refusal, branch confinement, stale revisions,
concurrent disable, refresh/staleness/proposal behavior, bounded fetches, Node/Workers
engine parity, and repeated tenant registry generation. CMS regressions cover
settings conflicts, unsaved navigation, owner controls, canceled proposals,
research changes during review and explicit save after acceptance.

Before shipping: run the full suites, rebuild the CMS, validate/build the site,
compile Pages Functions with the project's legacy compiler, and test an installed
package with a tenant-owned plugin. Live GitHub/Cloudflare writes and cron execution
need their own evidence; local mocks and builds are not deployment proof.

## Local verification receipt — October 11, 2026

- `npm test`: 486 backend/script tests and 635 CMS tests passed.
- Original evidence CLI suite: 11 tests passed after sharing the engine.
- CMS typecheck/production build passed; site validation: zero errors/warnings.
- Public build: 15 pages. Existing empty-taxonomy and large-public-chunk warnings remain.
- Legacy Wrangler 3.114.17 Functions compilation passed in the source checkout and
  an installed package tenant.
- Packed artifact installed into `/tmp/lanza-plugin-tenant-m3vcf7x3`; a synthetic
  tenant plugin survived regeneration, executed from the generated registry, and
  its private marker was absent from public output. Package inspection found no
  credentials or private state.
- Chromium fixture exercised enable → refresh → evidence on desktop and 390px
  mobile. No page errors or horizontal overflow. Screenshots:
  `/tmp/lanza-plugins-desktop.png` and `/tmp/lanza-plugins-mobile.png`.
- Browser/API tests used synthetic data and mocked GitHub responses. No live tenant
  source settings, repository visibility, remote branches or deployments changed.
