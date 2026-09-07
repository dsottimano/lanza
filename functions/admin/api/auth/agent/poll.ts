// "Connect an agent", step 2 — exchange the agent device code for a token, and
// RETURN IT to the page.
//
// This is the one endpoint in the CMS that hands a token to JavaScript, and it is
// deliberate rather than an oversight of the rule next door ("nothing token-shaped
// is ever returned"). That rule protects the SESSION: a durable credential in a
// cookie the page cannot read is what limits an XSS to the time the tab is open.
// This token is not a session. Its whole purpose is to be copied by a human into
// another program, so there is no version of this feature where the page never
// sees it. What is preserved instead:
//
//   * it is a DIFFERENT App's token, so it is not the signed-in session and cannot
//     become one;
//   * it is issued only to an owner, who is by definition already able to do
//     everything it permits;
//   * it is minted on an explicit click, never in the background;
//   * it is shown once and never stored by us — no cookie, no repo, nowhere.
import {
  pollDeviceFlow,
  readCookie,
  AGENT_DEVICE_COOKIE,
  clearAgentDeviceCookie,
} from "../../../../_lib/device-flow";
import { AGENT_CLIENT_ID } from "../../../../_lib/tenant-config";
import { roleMayUseCloudflare, type Role } from "../../../../_lib/roles";
import { identityFor } from "../../../../_lib/gh-identity";
import repo from "../../../../../lanza.config.json";

interface Env {
  AGENT_CLIENT_ID?: string;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
  data?: { role?: Role };
}): Promise<Response> => {
  const { request, env } = context;
  if (request.method !== "POST") return json(405, { message: "Method not allowed." });
  const role = context.data?.role;
  if (!role || !roleMayUseCloudflare(role)) {
    return json(403, { message: "Only an owner can connect an agent." });
  }

  const deviceCode = readCookie(request.headers.get("Cookie"), AGENT_DEVICE_COOKIE);
  if (!deviceCode) {
    return json(400, { status: "restart", message: "This authorization expired. Start again." });
  }

  const result = await pollDeviceFlow(env.AGENT_CLIENT_ID || AGENT_CLIENT_ID, deviceCode);
  if (result.status === "pending") {
    return json(200, { status: "pending", interval: result.interval });
  }
  if (result.status === "error") {
    return json(400, { status: "error", error: result.error });
  }

  // The App has expiring tokens off, so `expires_in` is absent and readTokens
  // substitutes the 8-hour default. Report what GitHub actually said rather than
  // that placeholder: a refresh token is the only reliable sign the App is
  // expiring tokens, and telling someone a permanent token dies in 8 hours (or the
  // reverse) is worse than saying nothing.
  const expiring = Boolean(result.tokens.refreshToken);

  // Authorizing is not enough: a GitHub App's user token only reaches repositories
  // the App is INSTALLED on, so a token from someone who skipped the install step
  // is well-formed, accepted by GitHub, and useless here — it would fail at the
  // agent's first call with a 404 that reads like the site is missing. Ask the
  // question now, while the person is still on the screen that can fix it.
  const check = await identityFor(result.tokens.accessToken, repo.owner, repo.name);
  const ready = check.status === "ok" && check.identity.role === "owner";
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
    // The code is spent. Don't leave it sitting in the browser.
    "set-cookie": clearAgentDeviceCookie(),
  });
  return new Response(
    JSON.stringify({ status: "ok", token: result.tokens.accessToken, expiring, ready }),
    { status: 200, headers },
  );
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
