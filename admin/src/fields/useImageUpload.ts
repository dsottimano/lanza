import { ref } from "vue";
import type { GitHubClient } from "../backend/github";
import { uploadImage } from "../backend/media";

/**
 * Shared image-upload flow for the form Image field (ImageInput) and the editor
 * Figure card (FigureView). Handles a file-input `change`: uploads the first
 * file as its own commit, hands the resulting public path to `onUploaded`, and
 * reports any failure via `onError` — leaving each caller to surface errors its
 * own way (a local message vs the global error dialog). Tracks `uploading` and
 * always clears the input so the same file can be re-picked. No-op without a
 * file or a GitHub client.
 */
export function useImageUpload(client: GitHubClient | undefined) {
  const uploading = ref(false);

  async function pick(
    e: Event,
    onUploaded: (url: string) => void,
    onError: (err: unknown) => void,
  ): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !client) return;
    uploading.value = true;
    try {
      onUploaded(await uploadImage(client, file));
    } catch (err) {
      onError(err);
    } finally {
      uploading.value = false;
      input.value = ""; // allow re-picking the same file
    }
  }

  return { uploading, pick };
}
