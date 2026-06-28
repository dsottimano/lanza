# Media

## Uploading images

Anywhere there's an image field — a post's featured image, an author avatar, an
OG/social image, or the editor's **Image with caption** card — you can either:

- **Upload** a file from your computer, or
- **Paste a URL** to an external image.

Uploaded files are committed to your repo under `public/images/uploads/` and served
as static assets (fast, on the CDN). The image field stores the public path, e.g.
`/images/uploads/photo.jpg`.

## Images are shared across languages

Images aren't language-specific, so uploads are **not** split by language — the
same `/images/uploads/…` file can be used by the English, Spanish, and French
versions of an entry. Add language-specific alt text or captions per translation.

## Tips

- Re-uploading a file with the same name **replaces** it in place.
- Compress large photos before uploading — they ship as-is.
- Use a descriptive filename; it becomes the public URL.
