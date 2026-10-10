// Site tools run in the open CMS, under its existing browser session. Never put
// a credential in a descriptor or result. Unsupported browsers need no polyfill.
export interface SiteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ModelContext {
  registerTool: (tool: SiteTool) => void | Promise<void>;
  unregisterTool: (name: string) => void | Promise<void>;
}

const registries = new WeakMap<ModelContext, {
  tail: Promise<void>;
  owners: Map<string, symbol>;
}>();

export function browserModelContext(): ModelContext | undefined {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext;
  return typeof context?.registerTool === "function" && typeof context?.unregisterTool === "function"
    ? context : undefined;
}

/** Serialize registration and removal across SPA screens, including slow APIs. */
export function registerSiteTools(tools: SiteTool[], context = browserModelContext()): () => void {
  if (!context) return () => {};
  let registry = registries.get(context);
  if (!registry) {
    registry = { tail: Promise.resolve(), owners: new Map() };
    registries.set(context, registry);
  }
  const state = registry;
  const owner = Symbol("site tools screen");
  let active = true;
  function enqueue(action: () => Promise<void>) {
    // An unavailable browser capability must not prevent ordinary CMS editing.
    state.tail = state.tail.then(action).catch(() => {});
  }
  enqueue(async () => {
    for (const tool of tools) {
      if (!active) return;
      await context.registerTool({ ...tool, execute: async input => {
        if (!active || state.owners.get(tool.name) !== owner) throw new Error("This screen is no longer open.");
        return tool.execute(input);
      } });
      state.owners.set(tool.name, owner);
    }
  });
  return () => {
    active = false;
    enqueue(async () => {
      for (const tool of tools) {
        if (state.owners.get(tool.name) !== owner) continue;
        state.owners.delete(tool.name);
        await context.unregisterTool(tool.name);
      }
    });
  };
}
