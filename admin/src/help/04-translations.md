# Translations

Lanza supports as many — or as few — languages as you want. You choose them when
you first set up the site, and can change them any time in **Settings → Languages**
(see below).

- **One language** → a single-language site: no URL prefixes, and the language
  toggle is hidden.
- **Several languages** → one **default language** at the root URLs, and the rest
  under a prefix (e.g. `/es/…`, `/fr/…`).

## Choosing your languages — *Settings → Languages*

Open **Settings → Languages** in the rail to:

- tick the languages the site publishes in,
- pick the **default language** (the one that lives at the root, no prefix).

Save, and everything follows: the editing toggle, the public URLs, `hreflang`
tags, and which content folders are used. **Removing a language hides it** from the
site and the editor immediately — any content files already written for it stay in
the repo (ignored) unless you delete them, so you can re-enable it later without
losing work.

## The language switcher

When more than one language is enabled, a **language toggle** appears at the top of
the left rail. It sets the language you're *currently editing*. When you switch:

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
