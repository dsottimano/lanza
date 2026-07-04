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

## Scope expanded → three-audience product site (Dave, 2026-07-03)

Not just a token reskin. The site must sell Lanza to **normies, developers, AND
AI agents** at once. First-principles spine (see below): **"the life of an edit"**
— `you say what you want → agent commits → Pages builds → edge serves → Google &
agents find it`. Same mechanism, narrated at three altitudes. Ownership / no
lock-in is the through-line (normie "you keep every file" · dev "fork it,
self-host" · agent "open format, open repo").

The 10x: every site builder for 20 yrs optimized **the editor**. The agent deletes
the editor — so we build a **repo an agent can drive** and get out of the way. And
the marketing site is *itself* agent-operable (`llms.txt` + a "for agents" layer),
proving the loop on contact.

### Decisions (Dave, 2026-07-03)
- **Surface map:** four routes (all bilingual es/en) — see phases.
- **Accent:** ONE restrained accent on the Ink/Paper monochrome (links, buttons,
  the `l↗` arrow, key marks). Not pure-mono. Brand editor can still swap it.
- **Theme:** light **and** dark from the start (Paper-on-Ink invert).
- **Wordmark:** wire the real SVG wordmark + `l↗` monogram from `lanza-brand`
  into the header; `l↗` is the parallax motion motif (up-and-out to the open web).
- **Parallax:** scroll-scrubbed pipeline (IntersectionObserver/scroll, stays
  static/cacheable — no WebGL, no heavy assets).
- Base = the existing **"Lanza brand" preset** promoted to `:root`
  (Ink `#201d1b` / Paper `#f3f1ea` / Jost / sharp / motion on).

### Surface map
| Route | Lead | Job |
|---|---|---|
| `/` (+`/en/`) | all three | Hero + ownership spine + parallax teaser + cost/time + CTA |
| `/how-it-works` | dev/agent | Full scroll-scrubbed pipeline |
| `/start` | normie | 3 steps · real domain cost · time commitment · "you just ask" |
| `/agents` + `llms.txt` | agent | The repo contract, machine-legible |

## Build phases (verify `astro check` + checkpoint between each)

- ☑ **P1 — Foundation** (done 2026-07-03; astro check + build clean): rewrote `:root` in `site.css` → Ink/Paper +
  Jost + one accent + sharp rhythm + **light/dark**; rework `--deed-green`/`--brass`
  extras so PostCard/JournalIndex/404 still read; `Base.astro` → load **Jost**
  (drop Fraunces/Space Grotesk from always-on), wire the SVG wordmark header +
  copy the asset into `frontend/public`; update `LANZA_DEFAULTS` in
  `admin/src/backend/brand.ts` so "reset to defaults" = the wordmark look.
- ☑ **P2 — Home** rebuild (`Manifesto.astro`, done 2026-07-03): "life of an edit"
  spine + three audience doors + ownership/cost-time + close; monochrome + launch
  accent; deed/leasehold metaphor retired; es/en; astro check + build clean.
- ☑ **P3 — `/how-it-works`** (done 2026-07-03): `HowItWorks.astro` + es/en pages.
  Sticky trajectory diagram + scrolling stage panels; IntersectionObserver lights
  the active node + fills the line; degrades to a readable stacked list (no-JS /
  reduced-motion / <820px). Honest named stack. astro check + build clean.
- ☑ **P4 — `/start`** (done 2026-07-03): `Start.astro` + es/en pages. What-you-need
  · the four steps · plain-numbers cost ledger ($0 + ~$12/yr domain) · no-lock-in
  reassurance · CTA → lanzacms.com. astro check + build clean.
- ☑ **P5 — `/agents`** (done 2026-07-03): `Agents.astro` + es/en pages. Read layer
  (/llms.txt · window.lanza · JSON-LD) + edit layer (read schema.ts → write .md/.html
  → commit). Points to the existing `/llms.txt` (unchanged). astro check + build clean.
- ☑ Loaded the **frontend-design** skill; direction "Trajectory" (lanza = throw,
  the ↗ as scroll-drawn launch arc).
- ☑ Verify: `astro check` 0 errors/0 warnings (78 files); build 11 pages clean;
  all six new routes render, cross-links resolve, wordmark header on deep pages.
  STILL TODO (Dave): eyeball live — light/dark, the scroll-scrub on /how-it-works,
  mobile; and confirm with a real brand override applied.

---

## ✅ Redesign shipped 2026-07-03 — four-surface, three-audience product site
Home (spine + 3 doors) · /how-it-works (scroll-scrub parallax) · /start (normie
onboarding + costs) · /agents (agent contract). Wordmark identity: Ink/Paper +
Jost + JetBrains Mono + one launch accent (#e4431b), light+dark. All es/en.
Remaining polish is visual QA + any copy tuning after Dave reviews live.

---

_Prior Architecture B (multi-tenant) roadmap removed from this file 2026-07-03 —
recover from git history or `admin/src/help/09-onboarding-and-hosting.md`._
