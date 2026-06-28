# Publishing & deploy

## Drafts vs. published

Every entry has a **Published** toggle. New entries start as **drafts**:

- **Draft** — saved to your repo but **hidden** from the live site's production
  build. Safe to work on over time.
- **Published** — included in the next build and visible to everyone.

Flip **Published** on and save when it's ready to go live.

## How publishing works

Saving in Lanza commits to GitHub. Your host (Cloudflare Pages) watches the repo
and **rebuilds the site automatically** on each commit. Within a minute or two the
change is live — no manual deploy step.

The build drops every `draft: true` entry, so drafts never reach the public site
even though they're committed.

## Going live in another language

A translation follows the same rule: it stays a draft until you publish it. You can
publish the English version now and its Spanish translation later — they're
independent.

## If something looks wrong

- **Change didn't appear?** Give the rebuild a minute, then hard-refresh. Check the
  repo's commit history to confirm your save landed.
- **A post shows raw HTML/markdown?** Open it in Lanza once and re-save — Lanza
  normalises the body to clean HTML.
