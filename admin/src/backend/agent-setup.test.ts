import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { codexSetupCommand } from "./agent-setup";

describe("agent setup command", () => {
  it("passes the complete credential and URL literally to the client environment", () => {
    const token = "test'$(printf injected)`printf bad`$HOME";
    const url = "https://example.test/api/mcp?literal='$(printf bad)";
    const script = [
      'codex() { printf "%s\\0" "$LANZA_OWNER_SITE_TOKEN" "$@"; }',
      codexSetupCommand(url, token, "owner/site"),
    ].join("\n");
    const result = execFileSync("sh", ["-c", script], { encoding: "utf8" }).split("\0");
    expect(result).toEqual([
      token, "mcp", "add", "lanza-owner-site", "--url", url,
      "--bearer-token-env-var", "LANZA_OWNER_SITE_TOKEN", "",
    ]);
  });

  it("uses separate credential variables and server names for separate sites", () => {
    expect(codexSetupCommand("https://a.test/api/mcp", "fixture", "owner/a"))
      .toContain("LANZA_OWNER_A_TOKEN");
    expect(codexSetupCommand("https://b.test/api/mcp", "fixture", "owner/b"))
      .toContain("LANZA_OWNER_B_TOKEN");
  });
});
