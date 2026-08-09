// Sign-in step 2 — exchange the device code for tokens (docs/security-todo.md §10.1).
//
// Still a relay, still no secret. The device code is read from the HttpOnly cookie
// this browser was given at /start, NOT from the request body — so a device code
// authorised in one browser cannot be presented by another. Without that, someone
// could authorise a flow with their OWN GitHub account and then hand the code to a
// victim's browser, signing that browser in as the attacker; the victim would then
// edit content into a repo they don't control. It is the device-flow shape of a
// login CSRF, and binding the code to the browser is what removes it.
//
// On success the tokens go straight into HttpOnly cookies. The response body says
// only that it worked. Nothing token-shaped is ever returned to JavaScript.
import {
  pollDeviceFlow,
  authCookies,
  readCookie,
  DEVICE_COOKIE,
} from "../../../../_lib/device-flow";
import { GITHUB_CLIENT_ID } from "../../../../_lib/tenant-config";

interface Env {
  GITHUB_CLIENT_ID?: string;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;
  if (request.method !== "POST") {
    return json(405, { message: "Method not allowed." });
  }

  const deviceCode = readCookie(request.headers.get("Cookie"), DEVICE_COOKIE);
  if (!deviceCode) {
    // Either /start was never called, or the 15-minute cookie lapsed. Both mean
    // "begin again" rather than "something is broken".
    return json(400, { status: "restart", message: "This sign-in expired. Start again." });
  }

  const result = await pollDeviceFlow(env.GITHUB_CLIENT_ID || GITHUB_CLIENT_ID, deviceCode);

  if (result.status === "pending") {
    // Not a failure: the person has not finished at github.com yet. 200, because a
    // 4xx here would have the SPA render an error mid-sign-in.
    return json(200, { status: "pending", interval: result.interval });
  }
  if (result.status === "error") {
    return json(400, { status: "error", error: result.error });
  }

  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  for (const set of authCookies(result.tokens)) headers.append("set-cookie", set);
  return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
