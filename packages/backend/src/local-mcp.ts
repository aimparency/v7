import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This module and the bundled backend entry point are both one directory below
// the backend package root. The absolute paths let agents launch from any workspace.
export function localMcpCommand() {
  const mcp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mcp');
  const host = process.env.BIND_HOST;
  const port = process.env.PORT_BACKEND_WS;
  const env: Record<string, string> = host || (port && port !== '3001') ? { BACKEND_WS_URL: `ws://${host || 'localhost'}:${port || '3001'}` } : {};
  return { command: path.join(mcp, 'node_modules/.bin/tsx'), args: [path.join(mcp, 'src/index.ts')], env };
}
