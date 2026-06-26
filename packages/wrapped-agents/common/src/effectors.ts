import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Real-world effector layer (aim 6119682f): give the wrapped worker session
 * "hands" via Composio's Tool Router MCP server (GitHub first surface — PRs,
 * issues, etc.). Integration is pure config: Composio exposes an HTTP MCP
 * endpoint authenticated with an X-API-Key header, which the claude CLI attaches
 * via --mcp-config. GitHub auth itself is handled by the Composio connection
 * (OAuth in the Composio dashboard), so no raw GitHub token is needed here.
 *
 * Strictly OPT-IN: returns null / [] unless ENABLE_EFFECTORS=true AND both
 * COMPOSIO_API_KEY and COMPOSIO_GITHUB_MCP_URL are set. Absent config is a no-op,
 * so the running loop is never affected until an operator deliberately enables it
 * with real credentials.
 */
export interface EffectorMcpConfig {
  name: string;
  url: string;
  apiKey: string;
}

export function getEffectorMcpConfig(env: NodeJS.ProcessEnv = process.env): EffectorMcpConfig | null {
  if (env.ENABLE_EFFECTORS !== 'true') return null;
  const url = env.COMPOSIO_GITHUB_MCP_URL;
  const apiKey = env.COMPOSIO_API_KEY;
  if (!url || !apiKey) return null;
  return { name: 'github-composio', url, apiKey };
}

/**
 * Write a claude-CLI --mcp-config file describing the effector server. Written to
 * the OS temp dir (NOT the repo) with 0600 perms because it embeds the API key.
 */
export function writeEffectorMcpConfigFile(config: EffectorMcpConfig, dir: string = os.tmpdir()): string {
  const file = path.join(dir, `aimparency-effectors-${process.pid}.json`);
  const payload = {
    mcpServers: {
      [config.name]: {
        type: 'http',
        url: config.url,
        headers: { 'X-API-Key': config.apiKey },
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return file;
}

/**
 * Extra worker CLI args that attach the effector MCP server, or [] when the
 * effector layer is disabled/unconfigured. Append to the profile's worker args.
 */
export function effectorWorkerArgs(env: NodeJS.ProcessEnv = process.env, dir?: string): string[] {
  const config = getEffectorMcpConfig(env);
  if (!config) return [];
  const file = writeEffectorMcpConfigFile(config, dir);
  return ['--mcp-config', file];
}
