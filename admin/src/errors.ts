import { reactive } from "vue";
import { GitHubError } from "./backend/github";

// Global error channel. Operational failures anywhere in the CMS (load / save /
// list / upload) call reportError(); a single ErrorDialog (mounted in App.vue)
// renders the latest one.
export const errorState = reactive<{ message: string | null; status: number | null }>({
  message: null,
  status: null,
});

export function reportError(e: unknown, fallback = "Something went wrong."): void {
  if (e instanceof GitHubError) {
    errorState.status = e.status;
    errorState.message = e.message || fallback;
  } else if (e instanceof Error) {
    errorState.status = null;
    errorState.message = e.message || fallback;
  } else if (typeof e === "string" && e) {
    errorState.status = null;
    errorState.message = e;
  } else {
    errorState.status = null;
    errorState.message = fallback;
  }
}

export function clearError(): void {
  errorState.message = null;
  errorState.status = null;
}

// 401/403/404 from GitHub almost always mean the server-side token is missing/
// expired or lacks access to the repo — surface that hint (the editor can't fix
// it in-browser; it's a server/proxy config issue).
export function isAuthError(status: number | null): boolean {
  return status === 401 || status === 403 || status === 404;
}
