# Settings

The **Settings** section in the rail holds site-wide files. Some are per-language
(they follow the rail's language toggle); some are global.

## SEO defaults — *per language*

Site name, title template, default description, default social image, and social
handles. These fill in whenever an entry doesn't set its own. Each language has its
own SEO defaults — the header shows which language you're editing (e.g. *· ES*).
`og:locale` is set automatically from the language.

Per-entry SEO (in the editor's settings drawer) always overrides these.

## Menu — *per language*

The site's navigation links. Each language has its own menu, so you can point the
Spanish menu at `/es/…` URLs with translated labels. If a language's menu is left
empty, the site auto-lists that language's Pages.

## Appearance — *global*

The site's theme. Applies to all languages.

## Redirects — *global*

Old-path → new-path rules, compiled to Cloudflare's native redirects at build time.
Use these when you change a URL so old links keep working. Status 301 = permanent.
