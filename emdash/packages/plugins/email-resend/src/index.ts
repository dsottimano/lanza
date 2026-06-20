import type { PluginDescriptor } from "emdash";

/**
 * Resend email provider — descriptor (build-time metadata, side-effect-free).
 * Imported by astro.config.mjs. The runtime entry (./runtime) registers the
 * exclusive `email:deliver` hook and sends via the Resend HTTP API.
 *
 * Why a plugin at all: EmDash routes every outbound email (invites, magic-link,
 * recovery, password reset) through ONE exclusive `email:deliver` provider. With
 * no provider, those features fail; only a dev-console logger is built in.
 *
 * Why Resend (not Cloudflare Email Sending): CF Email Sending requires the
 * Workers PAID plan. Resend has a free tier and is a plain HTTP API. To swap
 * providers, change only ./runtime.ts.
 *
 * Trusted in-process plugin (listed under `plugins:`, not `sandboxed:`), so it
 * runs in the host Worker — no sandbox / no paid Dynamic Workers. Config is read
 * at request time from Worker env: RESEND_API_KEY (secret) + EMAIL_FROM (var).
 */
export function emailResendPlugin(): PluginDescriptor {
	return {
		id: "email-resend",
		version: "1.0.0",
		// Native format: EmDash calls the entry's `createPlugin()` directly at
		// runtime (no adaptSandboxEntry) — the supported path on Cloudflare.
		format: "native",
		entrypoint: "@local/plugin-email-resend/runtime",
	};
}
