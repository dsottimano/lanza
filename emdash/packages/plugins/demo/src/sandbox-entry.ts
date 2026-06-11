import type { SandboxedPlugin } from "emdash/plugin";
import type { PluginContext } from "emdash";

// --- tiny helpers (shared by routes + admin UI) ------------------------------

function newId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** DB write: append a note to the plugin's own storage collection. */
async function addNote(ctx: PluginContext, text: string): Promise<string> {
	const id = newId();
	await ctx.storage.notes.put(id, {
		text,
		createdAt: new Date().toISOString(),
	});
	return id;
}

/** DB read: most-recent notes from plugin storage. */
async function listNotes(ctx: PluginContext, limit = 50) {
	const r = await ctx.storage.notes.query({
		orderBy: { createdAt: "desc" },
		limit,
	});
	return r.items.map((i: any) => ({ id: i.id, ...i.data }));
}

/**
 * DB read of REAL CMS content via the content:read capability.
 * Defensive: tolerates either a `.total` count or an items array, and never
 * throws (the demo page must still render if the signature differs).
 */
async function countPosts(ctx: PluginContext): Promise<number | null> {
	if (!ctx.content) return null;
	try {
		const r: any = await ctx.content.list("posts", { limit: 1 });
		return r?.total ?? r?.items?.length ?? 0;
	} catch (err) {
		ctx.log.warn(`[demo] countPosts failed: ${String(err)}`);
		return null;
	}
}

// --- plugin definition -------------------------------------------------------
// emdash@0.16: standard plugins export a plain object (NOT definePlugin()).
// Identity (id/version/capabilities/storage/adminPages) lives in the descriptor
// (src/index.ts). This file is just the runtime behaviour.

export default {
	hooks: {
		// Lifecycle hooks are bare async functions: (event, ctx).
		"plugin:install": async (_event: any, ctx: PluginContext) => {
			ctx.log.info("[demo] installed — notes storage ready");
		},

		// Content/media hooks take a { handler } object.
		// DB-on-event: record a note every time any content is saved.
		"content:afterSave": {
			handler: async (event: any, ctx: PluginContext) => {
				await addNote(
					ctx,
					`Content saved: ${event.collection}/${event.content?.id ?? "?"}`,
				);
				ctx.log.info(`[demo] recorded save of ${event.collection}`);
			},
		},
	},

	routes: {
		// GET /_emdash/api/plugins/demo/list  → read notes (DB)
		list: {
			handler: async (_routeCtx: any, ctx: PluginContext) => {
				return { items: await listNotes(ctx) };
			},
		},

		// POST /_emdash/api/plugins/demo/add  { text }  → write a note (DB)
		add: {
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const { text } = (routeCtx.input ?? {}) as { text?: string };
				const id = await addNote(ctx, text?.trim() || "manual note");
				return { success: true, id };
			},
		},

		// GET /_emdash/api/plugins/demo/stats → counts (own DB + real CMS content)
		stats: {
			handler: async (_routeCtx: any, ctx: PluginContext) => {
				return {
					notes: (await listNotes(ctx)).length,
					posts: await countPosts(ctx),
				};
			},
		},

		// Block Kit admin page handler (UI). Receives interactions; returns blocks.
		admin: {
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const interaction = routeCtx.input as {
					type: string;
					page?: string;
					action_id?: string;
					values?: Record<string, any>;
				};

				// Handle the "Add note" form submission, then re-render.
				let toast: any = undefined;
				if (
					interaction.type === "form_submit" &&
					interaction.action_id === "add_note"
				) {
					const text = interaction.values?.note_text?.trim() || "manual note";
					await addNote(ctx, text);
					toast = { message: "Note added", type: "success" };
				}

				const notes = await listNotes(ctx);
				const posts = await countPosts(ctx);

				const blocks: any[] = [
					{ type: "header", text: "Demo Plugin" },
					{
						type: "context",
						text: "Barebones demo: plugin-owned DB (notes) + a read of real CMS content + Block Kit UI.",
					},
					{ type: "divider" },
					{
						type: "fields",
						fields: [
							{ label: "Notes stored", value: String(notes.length) },
							{
								label: "Posts in CMS",
								value: posts === null ? "n/a" : String(posts),
							},
						],
					},
					{
						type: "form",
						block_id: "add-note",
						fields: [
							{ type: "text_input", action_id: "note_text", label: "New note" },
						],
						submit: { label: "Add note", action_id: "add_note" },
					},
					{
						type: "table",
						block_id: "notes-table",
						columns: [
							{ key: "text", label: "Note", format: "text" },
							{ key: "createdAt", label: "When", format: "relative_time" },
						],
						rows: notes,
						emptyText: "No notes yet — add one above or save any content.",
					},
				];

				return toast ? { blocks, toast } : { blocks };
			},
		},
	},
} satisfies SandboxedPlugin;
