// "Connect an agent", step 1 — begin a device flow against the AGENT App.
//
// Not exempt from the gate, and that is the difference from the sign-in relays next
// door: those must be reachable unauthenticated because they ARE how you
// authenticate, while this one mints a durable credential and may only be started
// by someone already signed in as an owner. The gate has done both checks by the
// time this runs; the owner check is repeated here because being admitted to
// /admin has never been the same thing as being allowed to do a particular thing
// (security-model.md I1).
import { startDeviceFlow, agentDeviceCookie } from "../../../../_lib/device-flow";
import { AGENT_CLIENT_ID } from "../../../../_lib/tenant-config";
import { roleMayUseCloudflare, type Role } from "../../../../_lib/roles";

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
  // Owner-only, the same bar MCP itself enforces — there is no point issuing a
  // token the endpoint it is for would refuse. (roleMayUseCloudflare is the
  // owner-only predicate; it is named for its first caller, not its meaning.)
  const role = context.data?.role;
  if (!role || !roleMayUseCloudflare(role)) {
    return json(403, { message: "Only an owner can connect an agent." });
  }

  const result = await startDeviceFlow(env.AGENT_CLIENT_ID || AGENT_CLIENT_ID);
  if (!result.ok) {
    return json(502, { message: "GitHub would not start an authorization.", error: result.error });
  }

  return new Response(JSON.stringify(result.view), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "set-cookie": agentDeviceCookie(result.deviceCode),
    },
  });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
