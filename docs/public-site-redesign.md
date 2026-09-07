# Public site redesign, September 2026

## Direction update, 2026-09-07

The local English/Spanish homepage and SEO now lead with “Never lose a good thought
again,” replacing the earlier agent-built-site pitch below. The final user decision
is conversation-first capture through ChatGPT/Claude into private GitHub notes;
see [product vision](product-vision.md). The new copy predates that last clarification
and still needs a targeted alignment pass, along with the fixed product guides.
It must continue distinguishing today's publishing CMS from unimplemented notes,
retrieval and memory. No deployment was performed in this conversation.

The September 7 site build passed (15 pages); the site checker reported two
undeclared header placeholders. The historical validation below is not a current
baseline for these edits. See [handoff](handoff-2026-09-07.md).

## Earlier publishing-site redesign

The product story is now “Let agents build. Make it yours.” The homepage explains
the human/agent division of work through actual editor screenshots, six features,
a three-step workflow, expanded details, ownership and practical questions.

English and Spanish homepage content lives in `content/pages/{en,es}/home.md`, using
`templates/editorial/`. Its fields are grouped by visible section and support the
CMS preview-to-field interaction. The prior manifesto template remains available.
Product screenshots in `public/product/` are captures of the actual CMS using sample
content and a mocked repository; no production content was written to capture them.
The Spanish page identifies the screenshots as English examples.

The existing How it works, Start and Agents routes now use a shared guide presentation
with bilingual Pages entries in `content/pages/{en,es}/` and the shared
`templates/product-guide/` preset. They cover the editor, setup, the MCP contract,
current limits, and review/publication. Architecture and Blog also have CMS entries
and presets; all public content pages are editable through the schema. Navigation,
footer links and SEO descriptions were updated. Product chrome is scoped to
`productSite:true`, preserving other tenants' default branding.

Removed outdated claims about guaranteed setup times, domain prices, universally
compatible agent connections and hosting being free forever. Save, readiness, Publish
and deployment completion are described as distinct steps.

Validation: full site build; Astro check with zero errors; site checker with zero
errors/warnings; 652 tests; Chrome desktop/mobile checks for the eight main localized
pages and homepage internal links. Verified homepage content editing, preview field
selection and autosave through mocked GitHub calls. Nothing deployed or published.
