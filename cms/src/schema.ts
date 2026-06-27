// The content model — the single source of truth that replaces Sveltia's
// `public/admin/config.yml`. Mirrors it field-for-field. The field-form renderer
// (Phase 3b) and the collection nav (Phase 3d) are driven entirely by this.
//
// Two collection kinds:
//   - "folder": one markdown file per entry (posts, pages, taxonomies, authors).
//     `body` decides whether the entry gets the TipTap writing canvas.
//   - "files": a fixed set of JSON files (Settings → seo / menu / redirects).

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
  fields: Field[]; // frontmatter fields (excludes the body)
}

export interface FileEntry {
  name: string;
  label: string;
  file: string; // repo path to the JSON file
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
    folder: "src/content/posts",
    body: "rich",
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
      seoField({ ogTypeDefault: "article", withAuthor: true }),
    ],
  },
  {
    kind: "folder",
    name: "pages",
    label: "Pages",
    labelSingular: "Page",
    folder: "src/content/pages",
    body: "rich",
    thumbnail: "featuredImage",
    fields: [
      { name: "title", label: "Title", widget: "string" },
      { name: "draft", label: "Draft (uncheck to publish)", widget: "boolean", default: true },
      { name: "description", label: "Excerpt", widget: "text", required: false },
      { name: "featuredImage", label: "Featured image", widget: "image", required: false },
      PAGE_BLOCKS,
      seoField({ ogTypeDefault: "website", withAuthor: false }),
    ],
  },
  {
    kind: "folder",
    name: "categories",
    label: "Categories",
    labelSingular: "Category",
    folder: "src/content/categories",
    body: "none",
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
    folder: "src/content/tags",
    body: "none",
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
    folder: "src/content/authors",
    body: "none",
    thumbnail: "avatar",
    fields: [
      { name: "title", label: "Name", widget: "string" },
      { name: "bio", label: "Bio", widget: "text", required: false },
      { name: "avatar", label: "Avatar", widget: "image", required: false },
    ],
  },
  {
    kind: "files",
    name: "settings",
    label: "Settings",
    files: [
      {
        name: "seo_defaults",
        label: "SEO defaults",
        file: "src/data/seo.json",
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
        file: "src/data/menu.json",
        fields: [
          {
            name: "items",
            label: "Menu items",
            labelSingular: "Menu item",
            widget: "list",
            fields: [
              { name: "label", label: "Label", widget: "string" },
              {
                name: "url",
                label: "URL / path",
                widget: "string",
                hint: "e.g. /, /about/, or https://example.com",
              },
            ],
          },
        ],
      },
      {
        name: "redirects",
        label: "Redirects",
        file: "src/data/redirects.json",
        fields: [
          {
            name: "redirects",
            label: "Redirects",
            labelSingular: "Redirect",
            widget: "list",
            fields: [
              { name: "from", label: "From path", widget: "string" },
              { name: "to", label: "To path / URL", widget: "string" },
              { name: "status", label: "Status code", widget: "number", default: 301, valueType: "int" },
            ],
          },
        ],
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
