<script setup lang="ts">
defineProps<{ name: string }>();

// Shared stroke weight keeps navigation quiet and recognizable at small sizes.
const paths: Record<string, string> = {
  posts: 'M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5',
  pages: 'M7 3h7l4 4v14H7z M14 3v5h4 M4 7v13',
  categories: 'M3 6h7l2 2h9v12H3z M3 6V4h7l2 2',
  tags: 'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  authors: 'M15 21v-2a5 5 0 0 0-10 0v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M18 14a5 5 0 0 1 3 5v2',
  appearance: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3c0-4-4-7-9-7 M7 10h.01 M10 6h.01 M15 7h.01',
  layout: 'M3 4h18v16H3z M3 9h18 M3 16h18',
  blocks: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  languages: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  redirects: 'M4 20v-8a5 5 0 0 1 5-5h11 M15 2l5 5-5 5',
  agent: 'M8 4v5 M16 4v5 M5 9h14v3a7 7 0 0 1-14 0z M12 19v3',
  health: 'M3 12h4l3-8 4 16 3-8h4',
  updates: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',
  pending: 'M9 4H5v17h14V4h-4 M9 3h6v4H9z M8 12h8 M8 16h5',
  publish: 'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01',
  logout: 'M9 3H4v18h5 M10 12h11 M16 7l5 5-5 5',
};
</script>

<template>
  <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] ?? paths.pages" />
  </svg>
</template>
