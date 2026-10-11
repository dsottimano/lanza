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

## Switching languages

For a localized entry, language tabs appear above the writing title and in
**Details**. Choose a language to open its linked translation. Lanza asks you to
save or discard unsaved changes before leaving the current entry.

Collection lists also let you choose the language you are browsing. Authors and
uploaded images are shared across languages.

## How a translation is linked

A post and its translation **share the same filename**. So:

- `posts/en/welcome.md` ← the English post
- `posts/es/welcome.md` ← its Spanish translation

Same filename = same entry, different language. On the public site, a **language
switcher** appears in the header linking the two, and search engines get correct
`hreflang` tags automatically.

## Translating an entry

1. Save the source entry, then choose another language using its language tab.
2. If no translation exists, choose **Ask AI to translate** or **Start blank**.
3. Ask AI saves a private request for your connected agent. Tell the agent to read
   your saved translation request; submitting it does not automatically start a chat.
   Private requests require a private repository and the site owner's access.
4. The agent reads the saved source and creates a linked, unpublished translation.
   Open its language tab to review the words, links and images before publishing.

**Start blank** opens a linked draft for you to write yourself. Both paths retain
the original filename even when the translated title is different. Do not create
an unrelated post just to match a translated title.

The agent works from the saved source, so save your latest edits first. Existing
translations are opened for review and are never overwritten by translation
creation. Saving and translating do not publish the site.

## Partial translations are fine

You don't have to translate everything. If a page exists only in English, there's
simply no `/es/` version — the header switcher only offers languages that exist.
