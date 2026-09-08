# Site plugins

## Product contract

Plugins are capabilities an agent builds for a human's specific needs. The human
asks for a feature; the agent implements it in that person's site, declares its
editable settings, tests it, and presents the change for review. The human can
configure, enable or disable the feature and decide when to publish it.

There will be no third-party plugin installation or marketplace. This is a product
boundary, not a missing feature or a future backlog item. Agent-built plugins belong
to the person's repository and follow the site's existing authorization, content,
review and publishing contracts.

## Current implementation

Settings → Brand & themes → Plugins currently offers two built-in browser features:

| Plugin | Applies to | Behavior |
|---|---|---|
| Reading progress | Posts, rich-text pages and starter detail articles | A decorative top bar measures progress through the article; short articles show no progress bar |
| Image zoom | Unlinked images in rich-text articles and starter galleries | A keyboard-accessible button opens a native modal; Escape closes it and restores focus |

Both are disabled by default. Toggle a feature, then Apply to staging. Cancel
restores the last loaded/applied choices without writing. Preview the staging
build and use the existing reviewed publishing flow. Disable and apply to remove
the behavior from the next published build. Existing image links are preserved.

The owner-only screen reads and writes `data/appearance.json`, retaining its
loaded SHA and all unrelated settings. A concurrent edit produces a conflict,
without retrying over the newer file. Reload to review the newer settings before
trying again. The schema declares `plugins.readingProgress` and `plugins.imageZoom`.
Only literal `true` enables a feature. Missing or unknown values cannot load code.

The catalog and resolver live in `frontend/lib/site-plugins.ts`; browser behavior
lives in `site-plugins-browser.ts`. Features use no server, account, telemetry or
external service. Without JavaScript, ordinary images and reading continue to work.
Older browsers without native dialog support keep ordinary images.

The two built-in examples demonstrate the controls; a dedicated agent authoring
workflow has not been implemented yet. An agent with repository access can build
another capability through a code change, declared settings, review and tests.
The current MCP tools do not install executable plugin code. Theme exports include
the frontend and appearance settings, so these choices travel with the design.
