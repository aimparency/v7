import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Test helper.
/** A stand-in for the claude CLI: records its argv and environment, prints the given JSON. */
export async function fakeClaude(output: unknown): Promise<{ command: string; recorded: () => Promise<{ argv: string[]; allowStop: string | undefined; cwd: string }> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-claude-'));
  const command = path.join(dir, 'claude');
  const record = path.join(dir, 'record.json');
  await fs.writeFile(command, `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), allowStop: process.env.AIMPARENCY_ALLOW_STOP, cwd: process.cwd() }));
process.stdout.write(${JSON.stringify(JSON.stringify(output))});
`, { mode: 0o755 });
  return { command, recorded: async () => JSON.parse(await fs.readFile(record, 'utf8')) };
}
