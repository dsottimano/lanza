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

/** Upload an image as its own commit; resolves to its public path/URL. */
export async function uploadImage(client: GitHubClient, file: File): Promise<string> {
  const name = fileSlug(file.name);
  const path = `${MEDIA.dir}/${name}`;
  await client.uploadBinary(path, await fileToBase64(file), `cms: upload ${name}`);
  return `${MEDIA.publicPrefix}/${name}`;
}
