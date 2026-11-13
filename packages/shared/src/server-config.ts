// One Aimparency server is described by one directory: its settings
// (server.json), its accounts, the list of its graphs, and the repositories of
// graphs created on it. Nothing of this lives in a graph's .bowman, so git
// never carries it. Node only.
//
// Without server.json the server is the local one: no login, the person at the
// machine may do everything. `"login": "accounts"` opens it to other people:
// everyone reads, accounts write the graphs they own or were given.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export function serverDir(): string {
  if (process.env.AIMPARENCY_SERVER_DIR) return path.resolve(process.env.AIMPARENCY_SERVER_DIR);
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'aimparency');
}

const ServerConfigSchema = z.object({
  login: z.enum(['none', 'accounts']).default('none'),
  // The server admins' wrapped agents: a shell on the server, so off unless switched on.
  agents: z.boolean().default(false),
  // Who may create graphs: every account, or only those the server admin selected.
  graphCreation: z.enum(['everyone', 'selected']).default('everyone'),
  // Who commits on this server when git has no identity configured.
  gitAuthor: z.object({ name: z.string().min(1), email: z.string().min(1) })
    .default({ name: 'Aimparency', email: 'aimparency@localhost' }),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

const cache = new Map<string, { mtimeMs: number; value: unknown }>();

/**
 * A JSON file of the server directory, re-read when it changed on disk (the
 * settings are edited as a file; the accounts CLI is another process).
 * `parse` gets null when the file does not exist.
 */
export function readServerFile<T>(name: string, parse: (raw: unknown) => T): T {
  const file = path.join(serverDir(), name);
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    // no file: the defaults
  }
  const cached = cache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.value as T;
  const value = parse(mtimeMs < 0 ? null : JSON.parse(fs.readFileSync(file, 'utf8')));
  cache.set(file, { mtimeMs, value });
  return value;
}

export function forgetServerFile(name: string) {
  cache.delete(path.join(serverDir(), name));
}

// A broken server.json throws here, on every request: the server stops
// answering instead of falling back to "no login" and opening everything.
export function serverConfig(): ServerConfig {
  return readServerFile('server.json', (raw) => {
    try {
      return ServerConfigSchema.parse(raw ?? {});
    } catch (error) {
      throw new Error(`${path.join(serverDir(), 'server.json')} is not valid: ${error instanceof Error ? error.message : error}`);
    }
  });
}

/** True when other people use this server: accounts exist and nothing is taken on trust. */
export function hasAccounts(): boolean {
  return serverConfig().login === 'accounts';
}

/** Sets some settings, keeping the rest of the file (the setup of `pnpm start`). */
export function updateServerConfig(values: Partial<ServerConfig>) {
  const file = path.join(serverDir(), 'server.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const next = { ...current, ...values };
  ServerConfigSchema.parse(next);
  fs.mkdirSync(serverDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  forgetServerFile('server.json');
}
