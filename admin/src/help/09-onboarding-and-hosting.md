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

## Creating the site's repo — two credentials  · **Live**

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

## The onboarding wizard  · **Live**

Go to **connect.lanzacms.com** and the whole setup above happens as one guided
walkthrough:

1. **Name your site** — type your business name, see an instant preview of a demo
   site before you've committed to anything.
2. **Connect GitHub** — sign in and authorize once; the wizard creates your content
   repo for you behind the scenes *(sign-up moment 1)*.
3. **Connect Cloudflare** — sign in and authorize once *(sign-up moment 2)*.
4. **One manual click** — Cloudflare has to be told it's allowed to build from your
   new GitHub repo. Neither service lets an app do this step on your behalf, so it's
   the one dashboard click that survives automation; the wizard deep-links you
   straight to it.
5. **Sit back** — the wizard creates the Cloudflare Pages project, connects it to
   your repo, and triggers the first deploy. Nothing left to click.
6. **The health screen** — a checklist confirms every piece is wired up (see below),
   then a button drops you straight into your CMS.

Every site launches today on a free `*.pages.dev` address; picking your own domain
is still a manual Cloudflare step (**Planned**: wizard-guided custom domains).

## The health screen

Two places show the same "is everything actually connected?" checklist:

- **At the end of the wizard**  · **Live** — once the wizard has created and
  deployed your site, a confirmation screen lights up each piece as it's verified:
  GitHub repo, Cloudflare hosting, Git integration, live deployment. When
  everything's green, a button takes you straight into `/admin`.
- **Settings → Site Health, inside the CMS**  · **Live** — the same idea, built to
  last. Anytime later it re-checks your GitHub connection, your Cloudflare token,
  your Pages project and its latest deploy status, and any KV/D1/R2 storage you've
  turned on — so if something breaks down the line (an expired token, a failed
  deploy) you see exactly what and why, instead of a blank screen.

The wizard's screen is the one-time "you did it" moment; Site Health is the same
checklist, always there.

## For developers — skip the wizard  · **Live**

Lanza is a self-sufficient CMS on its own — **connect.lanzacms.com** is a
convenience layer over it, never a requirement. A developer who'd rather not create
an account with us at all can self-host directly:

1. Clone the public template repo.
2. Set `ADMIN_LOGIN` to your own GitHub login — and, if you'd rather run your own
   login flow instead of the broker-mediated one, your own GitHub OAuth app.
3. Set your own `CLOUDFLARE_API_TOKEN`. The admin's Cloudflare proxy is dual-mode:
   if a site has its own token, it's used directly and the broker is never
   contacted.
4. `npm run build`, then deploy to Cloudflare Pages yourself.

No wizard, no OAuth consent to us, no broker involved at any point — this path is
an invariant the design was built around, not an afterthought.

## The broker

The wizard/marketing/onboarding logic lives in a **separate** app — the *broker* —
not in a customer's repo (it holds server-side credentials and must never be cloned
into a tenant). It's the `lanza-broker` repo, deployed as its own Pages project, and
is the home of **connect.lanzacms.com**. Customer sites live on their own Cloudflare
Pages.

## Draft vs live (unchanged)

Content edits commit to a **`staging`** branch (a preview deployment); **Publish**
merges `staging → main` (production). One repo, two branches — the draft/live split
falls out of Cloudflare Pages' built-in preview-vs-production behavior for free.
