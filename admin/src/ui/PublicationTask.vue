<script setup lang="ts">
defineProps<{
  isOwner: boolean;
  count: number | null;
  checkFailed: boolean;
}>();
defineEmits<{ (e: "review"): void; (e: "retry"): void }>();
</script>

<template>
  <div v-if="isOwner" class="flex flex-wrap items-center gap-2" aria-live="polite">
    <button
      v-if="count && count > 0"
      type="button"
      class="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-medium text-amber-950 transition hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
      :aria-label="`${count} ${count === 1 ? 'change' : 'changes'} waiting to be published. Review and publish.`"
      @click="$emit('review')"
    >
      <span class="h-2 w-2 rounded-full bg-amber-600" aria-hidden="true"></span>
      <span>Task: Review &amp; publish</span>
      <span class="rounded bg-amber-200 px-1.5 py-0.5 tabular-nums">{{ count }}</span>
    </button>
    <span v-if="checkFailed" class="text-amber-900">
      {{ count ? 'Count may be out of date.' : 'Could not check unpublished changes.' }}
      <button type="button" class="underline underline-offset-2" @click="$emit('retry')">Retry</button>
    </span>
  </div>
</template>
