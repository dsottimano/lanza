# Collections

Your content is organised into **collections**, listed in the left rail.

## Content

- **Posts** — time-ordered articles (a blog). They have a publish date, excerpt,
  featured image, categories, tags, and an author. Posts appear on the homepage
  and in archives.
- **Pages** — standalone content like *About* or *Contact*. No date; they live at
  a clean URL (`/about/`). Pages can use the rich editor and/or content blocks.

## Taxonomies

- **Categories** — hierarchical (a category can have a parent), WordPress-style.
- **Tags** — flat labels.

Create the term first (here), then assign it to a post from the post's settings
drawer. A post stores the term's **slug** (its filename), so renaming a term's
title is safe; changing its slug means re-assigning it.

## Authors

People you can credit on a post. Authors are **shared across all languages** — a
name is the same in every language — so they don't have a language switcher.

## How entries are stored

Each entry is one Markdown file in your repo. The **filename is the slug** (the
URL). For example a post titled "Hello World" is saved as `hello-world.md` and
appears at `/posts/hello-world/`.
