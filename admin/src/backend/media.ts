import type { GitHubClient } from "./github";
import { MEDIA } from "./config";

// Shared image-upload helper used by the form image field and the editor's
// Figure card. Commits the file under MEDIA.dir and returns its public path.

// An upload is committed to the repo and then served as a STATIC ASSET from the
// site's own origin — the same origin as /admin, where the session cookie lives
// and /admin/api/gh/* is whole-repo write. Cloudflare picks the response
// Content-Type from the extension, so the extension is what decides whether the
// browser renders a picture or executes a document. Hence an allowlist, checked
// here rather than on the <input accept="…">, which is only a picker hint the file
// dialog can be told to ignore.
//
// SVG is deliberately NOT on the list: it is a scriptable XML document
// (<script>, <foreignObject>, event handlers), served as image/svg+xml and executed
// on navigation. "It's an image" is a file-manager fact, not a browser one.
const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif"]);

// Sanitise a filename to a safe slug, preserving the extension.
export function fileSlug(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const base =
    (dot > 0 ? name.slice(0, dot) : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image";
  return ext ? `${base}.${ext}` : base;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Different source names can slug to the same file (e.g. "My Photo!!.jpg" and
// "my_photo.jpg" both → my-photo.jpg). When the slug already exists, ask whether
// to replace it; if not, append -2, -3… until a free name is found so an upload
// never silently clobbers an unrelated image.
async function resolveName(client: GitHubClient, base: string): Promise<string> {
  if (!(await client.exists(`${MEDIA.dir}/${base}`))) return base;
  if (confirm(`An image named "${base}" already exists. Replace it?`)) return base;

  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!(await client.exists(`${MEDIA.dir}/${candidate}`))) return candidate;
  }
}

/**
 * The extension an upload will be SERVED with — the same one fileSlug keeps — or
 * null if it isn't one we allow. Exported so callers/tests can check a pick before
 * anything is read or committed.
 */
export function uploadableExt(name: string): string | null {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return ALLOWED_EXT.has(ext) ? ext : null;
}

/** Upload an image as its own commit; resolves to its public path/URL. */
export async function uploadImage(client: GitHubClient, file: File): Promise<string> {
  // Refuse BEFORE reading the file, so nothing is base64'd and nothing is committed.
  if (!uploadableExt(file.name)) {
    throw new Error(
      `"${file.name}" isn't an image type Lanza will publish. ` +
        `Use ${[...ALLOWED_EXT].join(", ")} — SVG is excluded because it can carry script.`,
    );
  }
  const base64 = await fileToBase64(file);
  const name = await resolveName(client, fileSlug(file.name));
  const path = `${MEDIA.dir}/${name}`;
  await client.uploadBinary(path, base64, `lanza: upload ${name}`);
  return `${MEDIA.publicPrefix}/${name}`;
}
