// The content model — the single source of truth that replaces Sveltia's
// `public/admin/config.yml`. Mirrors it field-for-field. The field-form renderer
// (Phase 3b) and the collection nav (Phase 3d) are driven entirely by this.
//
// Two collection kinds:
//   - "folder": one markdown file per entry (posts, pages, taxonomies, authors).
//     `body` decides whether the entry gets the TipTap writing canvas.
//   - "files": a fixed set of JSON files (Settings → seo / menu / redirects).

import type { Locale } from "./backend/config";

export type Widget =
  | "string"
  | "text"
  | "datetime"
  | "boolean"
  | "number"
  | "image"
  | "select"
  | "relation"
  | "object"
  | "list";

export interface Field {
  name: string;
  label: string;
  widget: Widget;
  required?: boolean; // default true; set false for optional fields
  hint?: string;
  default?: unknown;
  // select
  options?: string[];
  // number
  valueType?: "int" | "float";
  // relation — target folder-collection name; pick from its entries by slug
  collection?: string;
  multiple?: boolean;
  // object
  fields?: Field[];
  collapsed?: boolean;
  // list — `fields` => object items; `types` => typed variants (page blocks);
  // neither => plain string items (e.g. organization.sameAs)
  types?: Variant[];
  labelSingular?: string;
}

export interface Variant {
  name: string; // discriminator written as `type`
  label: string;
  fields: Field[];
}

export interface FolderCollection {
  kind: "folder";
  name: string;
  label: string;
  labelSingular: string;
  folder: string;
  body: "rich" | "none"; // "rich" => TipTap canvas; "none" => form only
  thumbnail?: string; // field name used as the list thumbnail
  // When true, entries live in one subfolder per locale (folder/<locale>/<slug>.md)
  // and the active locale (App.vue) scopes the list + new-entry path. When false/
  // omitted the collection is shared across languages (e.g. authors).
  localized?: boolean;
  fields: Field[]; // frontmatter fields (excludes the body)
}

export interface FileEntry {
  name: string;
  label: string;
  file: string; // repo path to the JSON file (the base; see `localized`)
  // When true, the file has one variant per locale: `file` is the base name and
  // the active locale is spliced in before `.json` (menu.json → menu.es.json).
  localized?: boolean;
  // When set, App.vue opens a purpose-built pane instead of the generic
  // FieldForm (e.g. "menu" → MenuView.vue). `fields` is then unused.
  view?: "menu" | "redirects";
  fields: Field[];
}

export interface FileCollection {
  kind: "files";
  name: string;
  label: string;
  files: FileEntry[];
}

export type Collection = FolderCollection | FileCollection;

// ── shared field groups ──────────────────────────────────────────────────

// SEO object. Posts carry a JSON-LD `author`; pages don't (matches config.yml).
function seoField(opts: { ogTypeDefault: string; withAuthor: boolean }): Field {
  const fields: Field[] = [
    { name: "metaTitle", label: "Meta title (overrides title)", widget: "string", required: false },
    { name: "metaDescription", label: "Meta description", widget: "text", required: false },
    { name: "ogImage", label: "OG / social image", widget: "image", required: false },
    {
      name: "canonical",
      label: "Canonical URL (override)",
      widget: "string",
      required: false,
      hint: "Leave blank to auto-derive from the page path",
    },
    {
      name: "ogType",
      label: "OG type",
      widget: "select",
      options: ["website", "article"],
      default: opts.ogTypeDefault,
      required: false,
    },
    {
      name: "noindex",
      label: "Hide from search engines (noindex)",
      widget: "boolean",
      default: false,
      required: false,
    },
  ];
  if (opts.withAuthor) {
    fields.push({ name: "author", label: "Author (JSON-LD)", widget: "string", required: false });
  }
  return { name: "seo", label: "SEO", widget: "object", required: false, collapsed: true, fields };
}

// Per-entry TEMPLATE — the WordPress-style layout variant, shared by posts +
// pages. Options MUST mirror the frontend registry (frontend/lib/templates.ts,
// the source of truth); keep them in sync — the house pattern for shared shapes
// (cf. frontend/lib/site.ts ↔ MenuView.vue). Was named "layout" before the
// template feature; the frontend still reads the legacy key so old content is safe.
const TEMPLATE_FIELD: Field = {
  name: "template",
  label: "Template",
  widget: "select",
  options: ["default", "full-width", "landing"],
  default: "default",
  required: false,
  hint: "Layout variant: full-width breaks out to the wide measure; landing hides the page title and nav chrome.",
};

const PAGE_BLOCKS: Field = {
  name: "blocks",
  label: "Content blocks",
  labelSingular: "Block",
  widget: "list",
  required: false,
  types: [
    {
      name: "hero",
      label: "Hero",
      fields: [
        { name: "heading", label: "Heading", widget: "string" },
        { name: "subheading", label: "Subheading", widget: "text", required: false },
        { name: "image", label: "Background image", widget: "image", required: false },
        { name: "ctaText", label: "Button text", widget: "string", required: false },
        { name: "ctaUrl", label: "Button URL", widget: "string", required: false },
      ],
    },
    {
      name: "text",
      label: "Text",
      fields: [{ name: "body", label: "Text", widget: "text" }],
    },
    {
      name: "image",
      label: "Image",
      fields: [
        { name: "image", label: "Image", widget: "image" },
        { name: "alt", label: "Alt text", widget: "string", required: false },
        { name: "caption", label: "Caption", widget: "string", required: false },
      ],
    },
    {
      name: "gallery",
      label: "Gallery",
      fields: [
        {
          name: "images",
          label: "Images",
          widget: "list",
          fields: [
            { name: "image", label: "Image", widget: "image" },
            { name: "alt", label: "Alt text", widget: "string", required: false },
          ],
        },
      ],
    },
    {
      name: "cta",
      label: "Call to action",
      fields: [
        { name: "heading", label: "Heading", widget: "string", required: false },
        { name: "text", label: "Text", widget: "text", required: false },
        { name: "buttonText", label: "Button text", widget: "string" },
        { name: "buttonUrl", label: "Button URL", widget: "string" },
      ],
    },
  ],
};

// ── collections ──────────────────────────────────────────────────────────

export const COLLECTIONS: Collection[] = [
  {
    kind: "folder",
    name: "posts",
    label: "Posts",
    labelSingular: "Post",
    folder: "frontend/content/posts",
    body: "rich",
    localized: true,
    thumbnail: "featuredImage",
    fields: [
      { name: "title", label: "Title", widget: "string" },
      { name: "pubDate", label: "Publish date", widget: "datetime" },
      { name: "draft", label: "Draft (uncheck to publish)", widget: "boolean", default: true },
      { name: "description", label: "Excerpt", widget: "text", required: false },
      { name: "featuredImage", label: "Featured image", widget: "image", required: false },
      {
        name: "categories",
        label: "Categories",
        widget: "relation",
        collection: "categories",
        multiple: true,
        required: false,
      },
      {
        name: "tags",
        label: "Tags",
        widget: "relation",
        collection: "tags",
        multiple: true,
        required: false,
      },
      {
        name: "author",
        label: "Author",
        widget: "relation",
        collection: "authors",
        required: false,
      },
      TEMPLATE_FIELD,
      seoField({ ogTypeDefault: "article", withAuthor: true }),
    ],
  },
  {
    kind: "folder",
    name: "pages",
    label: "Pages",
    labelSingular: "Page",
    folder: "frontend/content/pages",
    body: "rich",
    localized: true,
    thumbnail: "featuredImage",
    fields: [
      { name: "title", label: "Title", widget: "string" },
      { name: "draft", label: "Draft (uncheck to publish)", widget: "boolean", default: true },
      { name: "description", label: "Excerpt", widget: "text", required: false },
      { name: "featuredImage", label: "Featured image", widget: "image", required: false },
      TEMPLATE_FIELD,
      PAGE_BLOCKS,
      seoField({ ogTypeDefault: "website", withAuthor: false }),
    ],
  },
  {
    kind: "folder",
    name: "categories",
    label: "Categories",
    labelSingular: "Category",
    folder: "frontend/content/categories",
    body: "none",
    localized: true,
    fields: [
      { name: "title", label: "Name", widget: "string" },
      { name: "description", label: "Description", widget: "text", required: false },
      {
        name: "parent",
        label: "Parent category",
        widget: "relation",
        collection: "categories",
        required: false,
      },
    ],
  },
  {
    kind: "folder",
    name: "tags",
    label: "Tags",
    labelSingular: "Tag",
    folder: "frontend/content/tags",
    body: "none",
    localized: true,
    fields: [
      { name: "title", label: "Name", widget: "string" },
      { name: "description", label: "Description", widget: "text", required: false },
    ],
  },
  {
    kind: "folder",
    name: "authors",
    label: "Authors",
    labelSingular: "Author",
    folder: "frontend/content/authors",
    body: "none",
    thumbnail: "avatar",
    fields: [
      { name: "title", label: "Name", widget: "string" },
      { name: "bio", label: "Bio", widget: "text", required: false },
      { name: "avatar", label: "Avatar", widget: "image", required: false },
    ],
  },
  // ── La Perle real-estate collections (added by the laperle theme) ──────────
  // Flat (not localized): the theme ships a single Spanish content set and
  // mirrors it with English UI chrome, so listings/regions/agents are shared.
  {
    kind: "folder",
    name: "listings",
    label: "Listings",
    labelSingular: "Listing",
    folder: "frontend/content/listings",
    body: "rich",
    thumbnail: "featuredImage",
    fields: [
      { name: "title", label: "Title", widget: "string" },
      { name: "draft", label: "Draft (uncheck to publish)", widget: "boolean", default: true },
      { name: "pubDate", label: "Publish date", widget: "datetime", required: false },
      { name: "featuredImage", label: "Featured image", widget: "image", required: false },
      {
        name: "gallery",
        label: "Gallery",
        labelSingular: "Photo",
        widget: "list",
        required: false,
        fields: [
          { name: "image", label: "Image", widget: "image" },
          { name: "alt", label: "Alt text", widget: "string", required: false },
        ],
      },
      {
        name: "listingType",
        label: "Listing type",
        widget: "select",
        options: ["sale", "rent", "sale_and_rent"],
        default: "sale",
      },
      {
        name: "listingStatus",
        label: "Status",
        widget: "select",
        options: ["active", "under_offer", "sold", "rented"],
        default: "active",
      },
      { name: "priceSale", label: "Sale price (USD)", widget: "number", valueType: "int", required: false },
      { name: "priceRent", label: "Rent price (USD / month)", widget: "number", valueType: "int", required: false },
      { name: "bedrooms", label: "Bedrooms", widget: "number", valueType: "int", required: false },
      { name: "bathrooms", label: "Bathrooms", widget: "number", valueType: "int", required: false },
      { name: "areaM2", label: "Built area (m²)", widget: "number", valueType: "int", required: false },
      { name: "lotM2", label: "Lot size (m²)", widget: "number", valueType: "int", required: false },
      { name: "latitude", label: "Latitude", widget: "number", valueType: "float", required: false },
      { name: "longitude", label: "Longitude", widget: "number", valueType: "float", required: false },
      {
        name: "region",
        label: "Region",
        widget: "relation",
        collection: "regions",
        required: false,
      },
      {
        name: "agent",
        label: "Agent",
        widget: "relation",
        collection: "agents",
        required: false,
      },
      {
        name: "features",
        label: "Features",
        widget: "list",
        required: false,
        hint: "One feature per item (e.g. pool, ocean_view).",
      },
      {
        name: "flowTags",
        label: "Quiz match tags",
        widget: "list",
        required: false,
        hint: "Tags the 'find your place' quiz matches on (e.g. coastal, investment).",
      },
      seoField({ ogTypeDefault: "article", withAuthor: false }),
    ],
  },
  {
    kind: "folder",
    name: "regions",
    label: "Regions",
    labelSingular: "Region",
    folder: "frontend/content/regions",
    body: "none",
    fields: [
      { name: "title", label: "Name", widget: "string" },
      { name: "description", label: "Description", widget: "text", required: false },
    ],
  },
  {
    kind: "folder",
    name: "agents",
    label: "Agents",
    labelSingular: "Agent",
    folder: "frontend/content/agents",
    body: "rich",
    thumbnail: "photo",
    fields: [
      { name: "title", label: "Name", widget: "string" },
      { name: "photo", label: "Photo", widget: "image", required: false },
      { name: "role", label: "Role", widget: "string", required: false },
      { name: "phone", label: "Phone", widget: "string", required: false },
      { name: "whatsapp", label: "WhatsApp number", widget: "string", required: false, hint: "Digits only, incl. country code (e.g. 50760000001)." },
      { name: "email", label: "Email", widget: "string", required: false },
      { name: "telegramChatId", label: "Telegram chat ID", widget: "string", required: false },
    ],
  },
  {
    kind: "files",
    name: "settings",
    label: "Settings",
    files: [
      {
        name: "appearance",
        label: "Appearance",
        file: "frontend/data/appearance.json",
        fields: [
          {
            name: "theme",
            label: "Site theme",
            widget: "select",
            options: ["editorial", "magazine", "landing", "classic"],
            default: "editorial",
            hint: "The public site's look. Per-entry Layout can still override the width.",
          },
          {
            name: "logo",
            label: "Logo",
            widget: "image",
            required: false,
            hint: "Shown in the site header in place of the text wordmark. Leave empty to use the site name.",
          },
        ],
      },
      {
        name: "seo_defaults",
        label: "SEO defaults",
        file: "frontend/data/seo.json",
        localized: true,
        fields: [
          { name: "siteName", label: "Site name", widget: "string" },
          {
            name: "titleTemplate",
            label: "Title template",
            widget: "string",
            hint: "Use %s where the page title goes, e.g. '%s · My Site'",
          },
          { name: "defaultTitle", label: "Default title", widget: "string" },
          { name: "defaultDescription", label: "Default description", widget: "text" },
          { name: "defaultOgImage", label: "Default OG image", widget: "image", required: false },
          {
            name: "locale",
            label: "Locale",
            widget: "string",
            default: "en_US",
            hint: "og:locale, e.g. en_US",
          },
          { name: "twitter", label: "Twitter @site handle", widget: "string", required: false },
          {
            name: "twitterCreator",
            label: "Twitter @creator handle",
            widget: "string",
            required: false,
          },
          {
            name: "organization",
            label: "Organization (JSON-LD)",
            widget: "object",
            fields: [
              { name: "name", label: "Name", widget: "string" },
              { name: "logo", label: "Logo", widget: "image", required: false },
              {
                name: "sameAs",
                label: "Social profile URLs",
                widget: "list",
                required: false,
                hint: "One URL per item (sameAs)",
              },
            ],
          },
        ],
      },
      {
        name: "menu",
        label: "Menu",
        file: "frontend/data/menu.json",
        localized: true,
        // Custom editor: menu locations (header/footer) × per-device menus.
        // Shape lives in frontend/lib/site.ts; edited by MenuView.vue, not FieldForm.
        view: "menu",
        fields: [],
      },
      {
        name: "redirects",
        label: "Redirects",
        file: "frontend/data/redirects.json",
        // Validation lives in backend/redirect-rules.ts; edited by
        // RedirectsView.vue, not FieldForm.
        view: "redirects",
        fields: [],
      },
    ],
  },
];

export function getCollection(name: string): Collection | undefined {
  return COLLECTIONS.find((c) => c.name === name);
}

export function folderCollections(): FolderCollection[] {
  return COLLECTIONS.filter((c): c is FolderCollection => c.kind === "folder");
}

// Repo folder for a collection in the active locale. Localized collections live
// in a per-locale subfolder (folder/<locale>); shared ones (authors) don't.
export function entryFolder(c: FolderCollection, locale: Locale): string {
  return c.localized ? `${c.folder}/${locale}` : c.folder;
}

// Repo path for a settings file in the active locale. Localized files splice the
// locale before `.json` (frontend/data/menu.json → frontend/data/menu.es.json); shared
// files (appearance, redirects) keep their path.
export function fileEntryPath(f: FileEntry, locale: Locale): string {
  return f.localized ? f.file.replace(/\.json$/, `.${locale}.json`) : f.file;
}
