// Sign-in step 1 — begin GitHub Device Flow (docs/security-todo.md §10.1).
//
// A relay, and only a relay: it exists because `github.com/login/*` sends no CORS,
// so the browser cannot make this call itself. It holds no secret — the whole
// request upstream is `client_id`, which is public.
//
// The device code comes back to the SERVER and stays there, in an HttpOnly cookie.
// The page is handed only what a human has to read off the screen: the user code
// and where to type it. So the browser never holds either half of the credential —
// not the device code that becomes a token, and not the token itself.
import { startDeviceFlow, deviceCookie } from "../../../../_lib/device-flow";
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

  const result = await startDeviceFlow(env.GITHUB_CLIENT_ID || GITHUB_CLIENT_ID);
  if (!result.ok) {
    // Pass GitHub's own reason through. `device_flow_disabled` in particular is a
    // one-checkbox fix on the App, and a generic "sign-in failed" would send
    // someone hunting through this code instead of into App settings.
    return json(502, { message: "GitHub would not start a sign-in.", error: result.error });
  }

  return new Response(JSON.stringify(result.view), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "set-cookie": deviceCookie(result.deviceCode),
    },
  });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
