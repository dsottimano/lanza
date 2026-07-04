# Lanza — Default theme redesign

Redesign the **default site theme** — the base look every un-branded Lanza site
ships with, and the face of the product/marketing site. Since the `data-theme`
preset concept was retired, "the theme" now means:

- `frontend/styles/site.css` — the `:root` token block (colors, fonts, radius,
  spacing) + the un-gated header/nav/footer chrome + prose/card/block rules.
- `frontend/components/Manifesto.astro` — the bilingual ES/EN manifesto home
  (hero, architecture diagram, CTAs). Pure CSS/type, no images/JS.
- `frontend/layouts/Base.astro` — header/footer shell, font `<link>`s.
- Shared primitives: `frontend/components/{PostCard,JournalIndex}.astro`,
  `frontend/pages/404.astro` (use `--gold`/`--rule`/`--text-secondary` aliases).

The CMS **Brand** editor overrides these tokens per-site (inline `<html style>`),
so whatever we set in `:root` is the *default*, not a hard-code — see
`frontend/lib/appearance.ts` / `admin/src/backend/brand.ts`.

**Status legend:** ☐ todo · ◐ in progress · ☑ done

---

## Brand inputs (the source of truth)

- Assets: `/home/dsottimano/source/lanza-brand/` (svg wordmark + `l↗` monogram,
  favicons, social). Wordmark = lowercase geometric sans + bold NE arrow.
- Brand colors: **Ink `#201D1B`**, **Paper `#F3F1EA`** (monochrome).
- Typeface: URW Gothic / Futura-like geometric sans (Jost is the free stand-in).
- Current base is still **Freehold** (deed-green + parchment + Fraunces/Space
  Grotesk) — decide how much of that survives vs. moving to the Ink/Paper wordmark
  identity.

---

## Direction — DECIDED: wordmark identity (Dave, 2026-07-03)

Move the default OFF Freehold's deed/parchment/green and onto the **literal
wordmark identity**: monochrome **Ink `#201D1B`** on **Paper `#F3F1EA`**, set in
**Jost** (Futura-like geometric sans). This is essentially today's "Lanza brand"
Brand preset promoted to the base `:root`. Consequence to design around: the
Manifesto + cards currently lean on `--deed-green` / `--brass` / brass-bright —
a monochrome scheme has to **rework or retire those** (the green architecture
diagram, the brass seals/kickers), not just recolor tokens.

## Open questions (still need Dave)

- ☐ **Accent** — pure monochrome makes links = text (Ink). Keep it fully
  monochrome (rely on weight/underline for emphasis), or allow ONE restrained
  accent (e.g. a warm brass/ochre, or Ink-tint)? Affects links, buttons, marks,
  the manifesto seals.
- ☐ **Wordmark in the header** — header shows `siteName` text today; wire the
  actual SVG wordmark / `l↗` monogram from `lanza-brand`? (Base.astro + asset.)
- ☐ **Motion default** — base ships `data-motion` off; keep off, or default subtle?
- ☐ Light-only, or a dark variant too?

## Build tasks

- ☐ Rewrite `:root` in `site.css` → Ink/Paper monochrome + Jost + geometric rhythm
  (radius likely sharp). Rework the `--deed-green`/`--brass`/`--rule` extras so the
  Manifesto + PostCard + 404 still read (recolor or restructure).
- ☐ Rework header/nav/footer chrome + `Manifesto.astro` to the monochrome identity
  (the green footer + brass accents are the biggest lift).
- ☐ Base font `<link>` in `Base.astro` → load **Jost** (drop Fraunces/Space Grotesk
  from the always-on set if they're no longer the default; keep JetBrains Mono only
  if the mono chrome survives).
- ☐ Update `LANZA_DEFAULTS` in `admin/src/backend/brand.ts` to the new base so the
  Brand editor's "reset to defaults" = the wordmark look (the "Lanza brand" preset
  and the base should now agree).
- ☐ Consider loading the frontend-design skill for the creative pass.
- ☐ Verify: `astro check` clean; build renders un-branded (new base look) AND with a
  brand override; check the manifesto + blog index + 404 + a post page.

---

_Prior Architecture B (multi-tenant) roadmap removed from this file 2026-07-03 —
recover from git history or `admin/src/help/09-onboarding-and-hosting.md`._
