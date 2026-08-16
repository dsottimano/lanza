// Real routes for the CMS (vue-router, hash history — the admin is a static SPA at
// /admin/, so hash URLs deep-link + survive a refresh with no server rewrites). The
// URL is the single source of truth for what's on screen; App.vue derives its panes
// from the current route and navigates with router.push. Panes don't render through
// <router-view> (each route uses a Blank placeholder) — App keeps its transition +
// props/emit wiring — but every screen still has a real, linkable URL:
//
//   #/pages/en            → the pages list, English
//   #/pages/en/home       → editing the English "home" page
//   #/pages/en/new        → a new page
//   #/settings/parts      → the Header & footer editor
//   #/publish · #/help
//
// Language is part of the URL, not a mode: the entry editor's locale bar
// (ui/EntryLocaleBar.vue) navigates to the SAME entry's `:locale` in another
// language, or to `.../new?slug=<stem>` to start one — real links to real pages.
import { createRouter, createWebHashHistory } from "vue-router";

// Panes render in App.vue, not here, so routes only need a placeholder component.
const Blank = { render: () => null };

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: Blank },
    // Specific paths before the generic /:collection/:locale so "settings"/"publish"
    // aren't read as a collection name.
    { path: "/settings/:panel", name: "settings", component: Blank },
    { path: "/publish", name: "publish", component: Blank },
    { path: "/help", name: "help", component: Blank },
    { path: "/:collection/:locale", name: "list", component: Blank },
    { path: "/:collection/:locale/:slug", name: "entry", component: Blank },
    // Anything else → home (App redirects home to the default list once ready).
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

/** Build the URL for a locale's list of a collection. */
export function listRoute(collection: string, locale: string): string {
  return `/${collection}/${locale}`;
}

/** Build the URL for editing (or creating, slug="new") an entry. */
export function entryRoute(collection: string, locale: string, slug: string): string {
  return `/${collection}/${locale}/${slug}`;
}
