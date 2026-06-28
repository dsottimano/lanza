# Translations

Lanza is multilingual by default. The site has a **default language** (English,
shown at the root URLs) plus translations (Spanish, French), which live under a
prefix: `/es/…`, `/fr/…`.

## The language switcher

At the top of the left rail is a **language toggle (EN / ES / FR)**. It sets the
language you're *currently editing*. When you switch:

- Posts, Pages, Categories and Tags show **that language's** entries.
- A new entry you create is saved into that language.
- The **Menu** and **SEO defaults** settings edit that language's version.

Authors and uploaded images are shared across languages, so they ignore the toggle.

## How a translation is linked

A post and its translation **share the same filename**. So:

- `posts/en/welcome.md` ← the English post
- `posts/es/welcome.md` ← its Spanish translation

Same filename = same entry, different language. On the public site, a **language
switcher** appears in the header linking the two, and search engines get correct
`hreflang` tags automatically.

## Translating an entry

1. Open or finish the entry in the default language (EN).
2. Switch the rail toggle to **ES** (or FR).
3. Create a new entry **with the same title/slug** as the original, and write the
   translated content.

Tip: give the translation the **same filename** as the original so they link up.
The filename comes from the title, so using the original title (or fixing the slug
to match) keeps them paired.

## Partial translations are fine

You don't have to translate everything. If a page exists only in English, there's
simply no `/es/` version — the header switcher only offers languages that exist.
