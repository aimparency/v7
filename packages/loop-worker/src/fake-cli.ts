import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Test helpers: stand-ins for the claude and codex CLIs. Each records its argv,
// working directory and AIMPARENCY_ALLOW_STOP, then answers like the real CLI.

type Recorded = { argv: string[]; allowStop: string | undefined; cwd: string };
type FakeCli = { command: string; recorded: () => Promise<Recorded> };

async function fakeCli(name: string, body: string): Promise<FakeCli> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `fake-${name}-`));
  const command = path.join(dir, name);
  const record = path.join(dir, 'record.json');
  await fs.writeFile(command, `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv, allowStop: process.env.AIMPARENCY_ALLOW_STOP, cwd: process.cwd() }));
${body}
`, { mode: 0o755 });
  return { command, recorded: async () => JSON.parse(await fs.readFile(record, 'utf8')) };
}

/** claude -p --output-format json: prints the given JSON. */
export function fakeClaude(output: unknown): Promise<FakeCli> {
  return fakeCli('claude', `process.stdout.write(${JSON.stringify(JSON.stringify(output))});`);
}

/** codex exec --json: writes the last message to --output-last-message and prints the JSONL events. */
export function fakeCodex(lastMessage: unknown, events: unknown[], exitCode = 0): Promise<FakeCli> {
  return fakeCli('codex', `fs.writeFileSync(argv[argv.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify(lastMessage))});
process.stdout.write(${JSON.stringify(events.map((event) => JSON.stringify(event)).join('\n'))});
process.exit(${exitCode});`);
}
