# Getting started

**Lanza** is your site's content editor. It saves everything straight to your
GitHub repository — there's no separate database or server. When you publish, your
static site rebuilds from those files.

## Signing in

There's nothing to sign into. Access to Lanza is controlled by **Cloudflare
Access** in front of `/admin` — once you're through that gate, the CMS opens
straight to your content. There's no token to paste and nothing kept in your
browser; the GitHub credentials live safely on the server.

If you see an **"Access problem"** message (a 401, 403, or 404 from GitHub),
that's a server-side setting, not something you can fix here — the site's GitHub
token may be missing, expired, or lacking **Contents: Read & write** on the repo.
Contact whoever administers the site to check it.

## First-run setup

The very first time you open a brand-new site, Lanza shows a short **setup wizard**
instead of the editor:

1. **Logo** — upload one now, or skip and add it later (Settings → Appearance).
2. **Starter theme** — pick the public look (`editorial`, `magazine`, `landing`,
   `classic`). Changeable any time in Settings → Appearance.
3. **Languages** — choose one language or several, and the default.

Click **Finish** and Lanza saves these to your repo and opens the editor. The
wizard only appears once — afterwards you go straight to your content. Everything
it sets is editable later under **Settings** (Appearance, Languages).

## The layout

- **Left rail** — the language switcher, your collections (Posts, Pages,
  Taxonomies), and Settings.
- **Main area** — the list of entries, or the editor when you open one.
- **Guide** — at the bottom of the rail (you're reading it now).

Changes are committed to your repo as you save. Open the repo's commit history any
time to see exactly what changed.
