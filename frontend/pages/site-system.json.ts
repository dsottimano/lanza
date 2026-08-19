// The composition contract, machine-readable — served on every Lanza site.
//
// The audience is an agent that was pointed at a site ten seconds ago and has not read
// docs/site-system.md, which is one file in a repo it does not have. /llms.txt names
// this URL; this is what it points at.
//
// It is generated from functions/_lib/site-system.mjs — the SAME constants
// `npm run check:site` and the MCP `validate_site` tool enforce — so what is published
// here cannot drift from what is actually checked. That is the whole reason it is an
// endpoint and not a static file someone maintains by hand.
import type { APIRoute } from "astro";
import { siteSystemContract } from "../../functions/_lib/site-system.mjs";

export const GET: APIRoute = async () =>
  // Minified, for the same reason the MCP layer minifies its tool results: the reader
  // is a model paying per token, and indentation was ~40% of this document. Browsers
  // pretty-print JSON for the humans.
  new Response(JSON.stringify(siteSystemContract()), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
