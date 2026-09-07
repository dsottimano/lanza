// Sign out: drop the device-flow cookies and return to /admin, which the gate then
// answers with the sign-in screen. Exempt from the gate (it's under /admin/api/auth/*).
//
// It used to clear `lanza_session` — the broker's RS256 cookie — and bounce to a
// login endpoint that no longer exists. After the device-flow cutover that made
// signing out a no-op: the three cookies that actually authenticate you survived it.
import { clearAuthCookies } from "../../../_lib/device-flow";

export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const headers = new Headers({
    Location: new URL("/admin/", context.request.url).toString(),
    "Cache-Control": "no-store",
  });
  for (const set of clearAuthCookies()) headers.append("Set-Cookie", set);
  return new Response(null, { status: 302, headers });
};
