import { ref } from "vue";

// Successful branch/file writes invalidate advisory chrome, never a publish review.
export const repositoryRevision = ref(0);
export const pendingCount = ref<number | null>(null);
export const pendingCheckFailed = ref(false);
