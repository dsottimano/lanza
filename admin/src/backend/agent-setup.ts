// POSIX shell quoting: generated credentials and origins must remain data.
function quote(value: string): string {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

export function codexSetupCommand(url: string, token: string, repo: string): string {
  const name = `lanza-${repo.replace(/[^a-zA-Z0-9_-]/g, "-") || "site"}`;
  const variable = `${name.replace(/-/g, "_").toUpperCase()}_TOKEN`;
  return [
    `export ${variable}=${quote(token)}`,
    `codex mcp add ${quote(name)} --url ${quote(url)} --bearer-token-env-var ${variable}`,
  ].join("\n");
}
