import type { APIRoute } from "astro";

/**
 * Access-mode "invite" endpoint (app-level, NOT an EmDash core change).
 *
 * Under Cloudflare Access (external auth), EmDash does NOT inject its built-in
 * auth routes — including POST /_emdash/api/auth/invite — so the admin UI's
 * Invite button 404s and hangs on "Sending…". There is also no "create user"
 * endpoint, so there is otherwise no UI way to onboard a teammate AT a chosen
 * role (auto-provisioned logins default to Author/Editor).
 *
 * This route fills the gap with Access-correct semantics: there is no passkey to
 * register, so "inviting" simply creates (or re-roles) the user row at the chosen
 * role and emails them a sign-in link. They sign in via Access and EmDash matches
 * them to this row by email.
 *
 * Wiring: it is INJECTED via a tiny integration in astro.config.mjs — NOT placed
 * in src/pages, because Astro silently ignores any src/pages path beginning with
 * "_" (so src/pages/_emdash/* never becomes a route). Injected routes run through
 * EmDash's auth middleware like any /_emdash route, so `locals.user` is the
 * authenticated admin and `locals.emdash` is the runtime.
 *
 * Only relevant when external auth is active. If you disable external auth (EmDash
 * re-injects its real invite route), remove this file AND its injectRoute entry.
 */

export const prerender = false;

const ROLE_NAMES: Record<number, string> = {
	50: "Admin",
	40: "Editor",
	30: "Author",
	20: "Contributor",
	10: "Subscriber",
};
const VALID_ROLES = new Set(Object.keys(ROLE_NAMES).map(Number));
const ADMIN = 50;

/** Crockford-base32 ULID (matches EmDash's user id format; no deps). */
function ulid(): string {
	const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let t = Date.now();
	let ts = "";
	for (let i = 9; i >= 0; i--) {
		ts = A[t % 32] + ts;
		t = Math.floor(t / 32);
	}
	let r = "";
	for (let i = 0; i < 16; i++) r += A[Math.floor(Math.random() * 32)];
	return ts + r;
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals as any;
	if (!emdash?.db) return json({ error: { code: "NOT_CONFIGURED", message: "EmDash is not initialized" } }, 500);
	if (!user || user.role < ADMIN) return json({ error: { code: "FORBIDDEN", message: "Admin privileges required" } }, 403);

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: { code: "INVALID_BODY", message: "Invalid JSON body" } }, 400);
	}

	const email = String(body?.email ?? "").trim().toLowerCase();
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		return json({ error: { code: "INVALID_EMAIL", message: "A valid email is required" } }, 400);
	}
	const role = VALID_ROLES.has(Number(body?.role)) ? Number(body.role) : 30;
	const now = new Date().toISOString();
	const loginUrl = `${new URL(request.url).origin}/_emdash/admin`;

	try {
		const existing = await emdash.db
			.selectFrom("users")
			.select(["id", "role"])
			.where("email", "=", email)
			.executeTakeFirst();

		let created = false;
		if (existing) {
			await emdash.db.updateTable("users").set({ role, updated_at: now }).where("id", "=", existing.id).execute();
		} else {
			await emdash.db
				.insertInto("users")
				.values({ id: ulid(), email, name: email.split("@")[0], role, email_verified: 1, created_at: now, updated_at: now })
				.execute();
			created = true;
		}

		// Best-effort sign-in email — Access is the actual credential, so a failure
		// here is non-fatal (the user can still log in).
		let emailed = false;
		try {
			if (emdash.email?.isAvailable?.()) {
				await emdash.email.send(
					{
						to: email,
						subject: "You've been given access to the CMS",
						text: `You've been granted access to the CMS.\n\nSign in: ${loginUrl}`,
						html: `<p>You've been granted access to the CMS.</p><p><a href="${loginUrl}">Sign in here</a>.</p>`,
					},
					"system",
				);
				emailed = true;
			}
		} catch {
			// ignore — invite still succeeds
		}

		const roleName = ROLE_NAMES[role] ?? String(role);
		const verb = created ? "Invited" : "Updated";
		const note = emailed ? " A sign-in email was sent." : "";
		return json({ data: { success: true, message: `${verb} ${email} as ${roleName}.${note}`, inviteUrl: loginUrl } });
	} catch (err) {
		return json(
			{ error: { code: "INVITE_FAILED", message: err instanceof Error ? err.message : "Failed to create invite" } },
			500,
		);
	}
};
