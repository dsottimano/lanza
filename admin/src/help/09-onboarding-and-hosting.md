# Onboarding & hosting

How a brand-new business owner goes from nothing to a live site — and the
architecture decisions behind it. This is the "why it's built this way" doc.
Each section is tagged **Live** (shipped) or **Planned** (decided, not yet built).

## The goal

Replace WordPress for people who are **not** developers — a plumber, a bakery, a
salon. That collides with reality: normal people don't have a GitHub account and
don't configure Cloudflare security. So the whole design is about hiding that
machinery behind a wizard.

## Who owns what

We chose the model where **the owner owns their own accounts** (GitHub for the
content repo, Cloudflare for hosting) and a **wizard automates the setup**. We did
*not* build a fully-hosted SaaS (where those accounts would be ours and invisible),
and we did *not* go agency/done-for-you.

The honest floor: because neither GitHub nor Cloudflare lets anyone create a user
account by API (anti-abuse), there are **two unavoidable sign-up moments** — a
GitHub account and a Cloudflare account. Everything *after* those two is automated.

## Logging in — "Sign in with GitHub"  · **Live**

The CMS door used to be **Cloudflare Zero Trust**. We removed it: Zero Trust's free
tier forces a **credit card** during setup, which kills the funnel for a
non-technical owner. It's replaced by:

- A small Pages Function gate (`functions/admin/_middleware.ts`) that checks a
  signed, HttpOnly session cookie before anything under `/admin` runs.
- A "Sign in with GitHub" round-trip (`functions/admin/api/auth/*`) that reads the
  user's GitHub identity **only** (no repo scopes requested, token discarded).
- An allowlist: the `ADMIN_LOGIN` setting names the one GitHub login allowed in.

No passwords, no credential storage, no card. The one shared "Lanza CMS" GitHub App
(slug `lanza-cms`) provides the login for every site; the per-site `ADMIN_LOGIN`
keeps each door private.

## Creating the site's repo — two credentials  · **Planned**

Creating a repo in someone's account needs repo-creation power, and there are two
ways to get it. We deliberately avoid the scary one:

- A **GitHub App** that can create repos must ask for *"Administration + All
  repositories"* — i.e. read/write to **every** repo you own. Absurd trust for a
  website tool. We don't use the App for creation.
- Instead an **OAuth flow with the `public_repo` scope** creates the repo **once**
  (token used and thrown away), and the GitHub App is then installed on **just that
  one repo, Contents-only** for ongoing edits.

Net result: the tool's standing access is **one repository, content only** — never
your other repos. This is the same pattern as Vercel/Netlify's "Deploy this
template" button.

## The starter, and why updates don't become "WordPress hell"  · **Planned**

The trap: if every customer's repo were a full copy of the CMS, then fixing a bug
in core would mean updating thousands of copies — WordPress's exact nightmare, where
every site is stuck on a different version.

So the tenant repo holds **only content**:

- `content/…`, `schema.json`, and a `package.json`.
- The CMS + Astro site + this admin app ship as a **versioned package**,
  `@lanza/site`, that the site's Cloudflare build pulls in at deploy time.

Fix core **once**, publish a new version, and every site gets it on its next build.
No copies to chase, no merge conflicts.

## How updates roll out  · **Planned**

Owners never see a version number. Sites track a **`@lanza/site@stable`** tag:

1. A new release lands on **our own dogfood site first** (the canary).
2. Once it's proven, we advance the `stable` tag.
3. A fan-out redeploy rebuilds every site onto it.

That's auto-update with a safety valve we hold — a bad release can't hit everyone,
and no site drifts onto ancient code.

## The onboarding wizard (target flow)  · **Planned**

1. Land on lanzacms.com → "Create your site" → name + business type.
2. Instant preview of a demo site (hook before asking for anything).
3. **Connect GitHub** — sign in; OAuth creates the content repo *(sign-up moment 1)*.
4. **Connect Cloudflare** — CF OAuth wires a Pages project to the repo
   *(sign-up moment 2)*.
5. Pick an address — a free subdomain now, a custom domain later.
6. Done → land in `/admin`, editing.

## The broker

The wizard/marketing/onboarding logic lives in a **separate** app — the *broker* —
not in a customer's repo (it holds server-side credentials and must never be cloned
into a tenant). It's the `lanza-broker` repo, deployed as its own Pages project, and
is the home of **lanzacms.com**. Customer sites live on their own Cloudflare Pages.

> Note: an early broker build used the GitHub App's `/generate` (the
> Administration-scoped path). That's being reworked to the OAuth-creation +
> thin-content-repo model described above.

## Draft vs live (unchanged)

Content edits commit to a **`staging`** branch (a preview deployment); **Publish**
merges `staging → main` (production). One repo, two branches — the draft/live split
falls out of Cloudflare Pages' built-in preview-vs-production behavior for free.
