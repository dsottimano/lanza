# Getting started

**Lanza** is your site's content editor. It saves everything straight to your
GitHub repository — there's no separate database or server. When you publish, your
static site rebuilds from those files.

## Signing in

Lanza signs in with a GitHub **fine-grained personal access token (PAT)**, kept
only in your browser (`localStorage`) — never sent anywhere but GitHub.

1. On GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.**
2. **Repository access:** *Only select repositories* → pick this site's repo.
3. **Permissions:** *Repository permissions → Contents → Read and write.*
4. Generate, copy the token, and paste it into Lanza's **Sign in with Token**.

If listing entries returns a **404**, the token can't see the repo — re-check that
you selected the right repository and granted **Contents: Read & write**.

## The layout

- **Left rail** — the language switcher, your collections (Posts, Pages,
  Taxonomies), and Settings.
- **Main area** — the list of entries, or the editor when you open one.
- **GitHub token / Sign out** — at the bottom of the rail.

Changes are committed to your repo as you save. Open the repo's commit history any
time to see exactly what changed.
