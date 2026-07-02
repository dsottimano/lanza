import type { GitHubClient } from "./github";
import { MEDIA } from "./config";

// Shared image-upload helper used by the form image field and the editor's
// Figure card. Commits the file under MEDIA.dir and returns its public path.

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

/** Upload an image as its own commit; resolves to its public path/URL. */
export async function uploadImage(client: GitHubClient, file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const name = await resolveName(client, fileSlug(file.name));
  const path = `${MEDIA.dir}/${name}`;
  await client.uploadBinary(path, base64, `lanza: upload ${name}`);
  return `${MEDIA.publicPrefix}/${name}`;
}
