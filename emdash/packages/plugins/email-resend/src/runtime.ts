import { env } from "cloudflare:workers";
import type { EmailDeliverEvent, PluginContext } from "emdash";

/**
 * Resend email provider — runtime entry (native format).
 *
 * ⚠️ HARD-WON GOTCHAS — change these and the Worker 500s or email silently dies:
 *
 *  1. NEVER import a *value* from "emdash" here (types are fine — they erase).
 *     EmDash's generated plugins module calls `createPlugin()` at module-eval
 *     time while EmDash itself is still initializing; a value import (even
 *     `definePlugin`) creates a circular dependency → TDZ crash ("Cannot access
 *     'X' before initialization") that 500s the whole Worker. So we return the
 *     resolved-plugin object LITERALLY (mirrors `defineNativePlugin()` output).
 *     (This is independent of the astro.config `manualChunks` emdash collapse,
 *     which only covers emdash's own chunks — not this @local/* plugin chunk.)
 *  2. `email:deliver` is gated by capability `hooks.email-transport:register`
 *     (canonical) — without it EmDash silently skips the hook.
 *  3. The hook must be `exclusive: true` — EmDash auto-selects the sole exclusive
 *     provider; otherwise `email.isAvailable()` stays false.
 *  4. Read env (RESEND_API_KEY / EMAIL_FROM) INSIDE the handler —
 *     `cloudflare:workers` env disallows property access at module/global scope.
 *  5. Use `format: "native"` in the descriptor, not "standard" (standard runs
 *     the TDZ-prone `adaptSandboxEntry`).
 *
 * Worker config required:
 *  - secret: `RESEND_API_KEY`  (wrangler secret put RESEND_API_KEY)
 *  - var:    `EMAIL_FROM`      e.g. "My Site <noreply@mail.example.com>"
 *  - a domain verified in Resend matching the EMAIL_FROM address.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

async function deliver(event: EmailDeliverEvent, ctx: PluginContext): Promise<void> {
	const e = env as Record<string, unknown>;
	const apiKey = e.RESEND_API_KEY as string | undefined;
	const from = e.EMAIL_FROM as string | undefined;
	if (!apiKey) throw new Error("[email-resend] RESEND_API_KEY secret missing.");
	if (!from) throw new Error('[email-resend] EMAIL_FROM var missing (e.g. "My Site <noreply@mail.example.com>").');

	const { message } = event;
	const res = await fetch(RESEND_ENDPOINT, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			from,
			to: message.to,
			subject: message.subject,
			text: message.text,
			html: message.html ?? message.text,
		}),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`[email-resend] Resend send failed (${res.status}): ${detail.slice(0, 300)}`);
	}
	ctx.log.info(`[email-resend] delivered to ${message.to} (source: ${event.source})`);
}

export function createPlugin() {
	// Returned object mirrors `defineNativePlugin()` output exactly — see gotcha #1.
	return {
		id: "email-resend",
		version: "1.0.0",
		capabilities: ["hooks.email-transport:register"],
		allowedHosts: [],
		storage: {},
		hooks: {
			"email:deliver": {
				priority: 100,
				timeout: 5000,
				dependencies: [],
				errorPolicy: "abort",
				exclusive: true,
				handler: deliver,
				pluginId: "email-resend",
			},
		},
		routes: {},
		admin: {},
	};
}
