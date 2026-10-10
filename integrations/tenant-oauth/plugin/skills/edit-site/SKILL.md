---
name: edit-site
description: Review or edit persisted content, design and pending changes on the connected Lanza tenant. Use live CMS site tools when the task concerns the open editor's unsaved text or selection.
---

Call `get_site` and `list_collections` to establish the tenant, URLs and locale.
Inspect the relevant declared schema and existing entry before changing it. For
design work, also call `describe_site_system` and inspect the template declarations.
Preserve unrelated frontmatter, body, translations and draft visibility.

Remote tools operate on committed Git content. They cannot see the open editor's
selection or unsaved changes. When those matter, use `get_cms_context` and the
live editor site tools if available, or ask the user to open the relevant editor.
Live proposals require the latest editor revision and human review; Save is separate.

Remote write tools create staging commits. They are persisted changes, not local
editor proposals. Use them only within the user's requested editing scope. If the
server requests an additional OAuth scope, explain the operation it enables.
Granting a scope alone is not an instruction to change or publish content.

For publication, run `validate_site` and review `list_changes`, including unrelated
pending human work. If publication is authorized, pass the reviewed production and
staging SHAs. For divergence, use `update_drafts` only when reconciliation is within
scope, then validate and review the combined result again. Report a Git publication
separately from deployment completion; do not claim the live site changed without
verifying it. For an editing task, hand off the staged changes and their review URL.

Report the exact collection, locale and entry path so the human can find the change
in the CMS. Never request or expose GitHub tokens or put private notes into a public
site repository. This integration does not provide private-note storage.
