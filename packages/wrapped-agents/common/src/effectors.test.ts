import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getEffectorMcpConfig, effectorWorkerArgs } from './effectors';

const enabled = {
  ENABLE_EFFECTORS: 'true',
  COMPOSIO_API_KEY: 'secret-key',
  COMPOSIO_GITHUB_MCP_URL: 'https://tool-router.composio.dev/session/abc',
} as NodeJS.ProcessEnv;

test('getEffectorMcpConfig is null unless enabled AND both creds present', () => {
  assert.equal(getEffectorMcpConfig({} as NodeJS.ProcessEnv), null, 'nothing set');
  assert.equal(getEffectorMcpConfig({ ENABLE_EFFECTORS: 'true' } as NodeJS.ProcessEnv), null, 'flag only');
  assert.equal(getEffectorMcpConfig({ ENABLE_EFFECTORS: 'true', COMPOSIO_API_KEY: 'k' } as NodeJS.ProcessEnv), null, 'no url');
  assert.equal(getEffectorMcpConfig({ COMPOSIO_API_KEY: 'k', COMPOSIO_GITHUB_MCP_URL: 'https://x' } as NodeJS.ProcessEnv), null, 'creds but flag off');
  const c = getEffectorMcpConfig(enabled);
  assert.equal(c?.name, 'github-composio');
  assert.equal(c?.url, enabled.COMPOSIO_GITHUB_MCP_URL);
});

test('effectorWorkerArgs is [] when disabled, and writes a valid --mcp-config when enabled', () => {
  assert.deepEqual(effectorWorkerArgs({} as NodeJS.ProcessEnv), [], 'disabled -> no args (no behavior change)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eff-test-'));
  const args = effectorWorkerArgs(enabled, dir);
  assert.equal(args[0], '--mcp-config');

  const written = JSON.parse(fs.readFileSync(args[1]!, 'utf8'));
  const server = written.mcpServers['github-composio'];
  assert.equal(server.type, 'http');
  assert.equal(server.url, enabled.COMPOSIO_GITHUB_MCP_URL);
  assert.equal(server.headers['X-API-Key'], 'secret-key');

  fs.rmSync(dir, { recursive: true, force: true });
});
