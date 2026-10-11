import { TOOL_LIST } from "../../../functions/_lib/mcp-core";

export const SCOPES = ["content.read", "content.write", "site.design", "site.publish", "offline_access"];
export const SCOPE_LABELS: Record<string, string> = {
  "content.read": "Read this site's content, settings, templates, pending changes and private agent requests",
  "content.write": "Create, change and delete content in staging; answer private agent requests",
  "site.design": "Change templates, the content model, brand, navigation and SEO in staging",
  "site.publish": "Reconcile and publish reviewed staging commits",
  "offline_access": "Keep this connection for up to 30 days",
};

// Exhaustive, fail closed. A new upstream tool must be classified before this
// adapter will expose or execute it. Scopes do not replace GitHub owner checks.
export const TOOL_SCOPES: Record<string, string> = {
  get_site: "content.read", list_collections: "content.read",
  get_schema: "content.read", list_content: "content.read", read_content: "content.read",
  list_changes: "content.read", list_translations: "content.read", create_translation: "content.write",
  list_agent_requests: "content.read", read_agent_request: "content.read",
  respond_to_agent_request: "content.write",
  describe_site_system: "content.read", get_settings: "content.read", validate_site: "content.read",
  create_content: "content.write", update_content: "content.write", delete_content: "content.write",
  write_template: "site.design", create_content_type: "site.design",
  update_content_type: "site.design", write_part: "site.design",
  set_brand: "site.design", set_menu: "site.design", set_seo: "site.design",
  update_drafts: "site.publish", publish: "site.publish",
};

export const OAUTH_TOOLS = TOOL_LIST.filter((tool) => TOOL_SCOPES[tool.name]).map((tool) => {
  const scope = TOOL_SCOPES[tool.name];
  return {
    ...tool,
    annotations: {
      readOnlyHint: scope === "content.read",
      destructiveHint: scope !== "content.read" && !["create_content", "create_content_type"].includes(tool.name),
      openWorldHint: true,
    },
    securitySchemes: [{ type: "oauth2", scopes: [...new Set(["content.read", scope])] }],
  };
});

export function missingScopes(payload: unknown, granted: readonly string[]): string[] {
  const required = new Set(["content.read"]);
  for (const item of Array.isArray(payload) ? payload : [payload]) {
    if (!item || typeof item !== "object") continue;
    const message = item as { method?: unknown; params?: { name?: unknown } };
    if (message.method === "tools/call") {
      const name = typeof message.params?.name === "string" ? message.params.name : "";
      const scope = Object.hasOwn(TOOL_SCOPES, name) ? TOOL_SCOPES[name] : undefined;
      // Unknown tools are refused separately; no inherited object property is a scope.
      if (scope) required.add(scope);
    }
  }
  return [...required].filter((scope) => !granted.includes(scope));
}
