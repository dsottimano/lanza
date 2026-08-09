// Prototype: a CMS auth path that holds NO SECRET.
//
// Proving three things end to end against a real repo:
//   1. A user signs in with GitHub Device Flow. Nothing here holds a client secret,
//      because the flow does not have one. Grep this file for "secret" — there is
//      none to find.
//   2. "May this person edit?" is answered by GitHub (`permissions.push`), not by
//      us. No adminLogin, no editors list, no roles.ts.
//   3. "May this person publish?" is answered by branch protection on `main`, not
//      by us.
//
// WHY THIS FILE EXISTS AT ALL (the CORS finding): github.com/login/* sends no
// Access-Control-Allow-Origin, so a browser cannot start or poll device flow
// itself — verified 2026-08-09: OPTIONS → 404, POST → 200 with no ACAO. But
// api.github.com DOES send `access-control-allow-origin: *`. So the shape is
// zero-SECRET, not zero-SERVER: two thin relays for the auth handshake, and a
// token-attaching proxy so the credential can live in an HttpOnly cookie instead
// of in JavaScript.
//
// Run: node prototype/device-cms/server.mjs   → http://localhost:4400
// Not shipped: `prototype/` is absent from package.json "files".
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 4400;

// PUBLIC values. The client id appears in every authorize URL; the repo is a
// throwaway. Neither is a credential.
const CLIENT_ID = "Iv23ct5fK2N5QtDUbzyx";
const REPO = "dsottimano/dave-test";
const WORKING_BRANCH = "staging";
const PRODUCTION_BRANCH = "main";
const COOKIE = "proto_gh_token";

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });

const tokenFrom = (req) =>
  req.headers.cookie?.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`))?.[1];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await readFile(join(HERE, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (url.pathname === "/api/config") {
    return json(res, 200, { repo: REPO, workingBranch: WORKING_BRANCH, productionBranch: PRODUCTION_BRANCH });
  }

  // ── 1. Start device flow. client_id only. ─────────────────────────────────
  if (url.pathname === "/api/device/start" && req.method === "POST") {
    const r = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID }),
    });
    return json(res, r.status, await r.json());
  }

  // ── 2. Poll for the token. Still no secret. ───────────────────────────────
  // On success the token goes into an HttpOnly cookie and is NOT returned to the
  // page — the browser never holds it in JavaScript, so an XSS cannot exfiltrate a
  // durable credential (it could still drive the proxy while the page is open,
  // which is true of the production design too).
  if (url.pathname === "/api/device/poll" && req.method === "POST") {
    const { device_code } = await readBody(req);
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: device_code ?? "",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await r.json();
    if (!data.access_token) return json(res, 200, { pending: data.error ?? "unknown" });
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "set-cookie": `${COOKIE}=${data.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${data.expires_in ?? 28800}`,
    });
    return res.end(JSON.stringify({ ok: true, expires_in: data.expires_in }));
  }

  if (url.pathname === "/api/logout") {
    res.writeHead(200, { "set-cookie": `${COOKIE}=; Path=/; Max-Age=0`, "content-type": "application/json" });
    return res.end("{}");
  }

  // ── 3. Token-attaching proxy. ─────────────────────────────────────────────
  // Note what is NOT here: no path allowlist deciding who may touch what, no role
  // check, no branch check. The token is the USER'S OWN and GitHub bounds it to
  // (App installation ∩ their permissions) — verified: 2 writable repos out of 33
  // owned. That bound is the authorization, so this proxy has no policy to enforce.
  if (url.pathname.startsWith("/api/gh/")) {
    const token = tokenFrom(req);
    if (!token) return json(res, 401, { message: "Not signed in." });
    const target = `https://api.github.com/${url.pathname.slice("/api/gh/".length)}${url.search}`;
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "lanza-device-prototype",
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(await readBody(req)) : undefined,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(text || "{}");
  }

  json(res, 404, { message: "Not found." });
});

server.listen(PORT, () => {
  console.log(`device-flow CMS prototype → http://localhost:${PORT}`);
  console.log(`repo ${REPO} · secrets held by this server: 0`);
});
