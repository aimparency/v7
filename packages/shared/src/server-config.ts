// One Aimparency server is described by one directory: its settings
// (server.json), its accounts, the list of its graphs, and the repositories of
// graphs created on it. Nothing of this lives in a graph's .bowman, so git
// never carries it. Node only.
//
// Without server.json the server is the local one: no login, the person at the
// machine may do everything. `"login": "accounts"` opens it to other people:
// accounts write the graphs they own or were given; who reads is
// guestDefaults.read (everyone, unless set otherwise) and each graph's own setting.
//
// One machine can hold several servers, each with a name: its directory is
// ~/.local/share/aimparency/<name> (server-directory.mjs). AIMPARENCY_SERVER
// names the one a process works on (`--server <name>` of the launcher and the
// CLIs sets it); without it that is "local". AIMPARENCY_SERVER_DIR gives a
// directory directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { serverDirectory as serverDir } from './server-directory.mjs';

export { serverDir };

const ServerConfigSchema = z.object({
  login: z.enum(['none', 'accounts']).default('none'),
  // Where spaces created on this server (and spin-offs, by default) go, one
  // directory each; `~/` is the home directory. Without it: <server dir>/spaces.
  spacesDir: z.string().min(1).optional(),
  // Where the launcher (`pnpm start`, `pnpm dev`) puts this server: the port
  // people open (with accounts the one port for everything) and the address it
  // listens on (127.0.0.1 behind a proxy, 0.0.0.0 for everyone). Servers on
  // one machine get different ports here and run side by side.
  port: z.number().int().positive().optional(),
  host: z.string().min(1).optional(),
  // The server admins' wrapped agents: a shell on the server, so off unless switched on.
  agents: z.boolean().default(false),
  // Who may create graphs: every account, or only those the server admin selected.
  graphCreation: z.enum(['everyone', 'selected']).default('everyone'),
  // How people get an account without the server admin making one: `open`
  // lets anyone choose a name and password; `browserKey` gives a visitor an
  // account without asking, held by a key in their browser. Invitations work
  // either way.
  // `wallet` lets people log in by signing with a crypto wallet (Sign-In with
  // Ethereum, checked by this server alone); it needs `publicUrl`. An unknown
  // wallet gets a new account where sign-up is open.
  signUp: z.object({
    open: z.boolean().default(false),
    browserKey: z.boolean().default(false),
    wallet: z.boolean().default(false),
  }).prefault({}),
  // The address people reach this server at, e.g. "https://graphs.example.org".
  // A wallet shows it when signing in, and the server accepts a signature only
  // for it, so a signature given to another website is worthless here.
  publicUrl: z.string().url().optional(),
  // What accounts without rights on a graph (guests) may do there, unless the
  // graph's owner set it otherwise: `everyone` every account, `selected` the
  // accounts the owner named, `nobody`.
  // Who reads a graph besides its owner and writers: `everyone` (visitors
  // without a login too), `accounts` every logged-in account, `selected` the
  // accounts the owner named.
  guestDefaults: z.object({
    notes: z.enum(['everyone', 'selected', 'nobody']).default('everyone'),
    read: z.enum(['everyone', 'accounts', 'selected']).default('everyone'),
  }).prefault({}),
  limits: z.object({
    // New accounts from one address; a whole room may share one address.
    accountsPerAddressPerHour: z.number().int().positive().default(100),
    graphsPerAccount: z.number().int().positive().default(20),
    notesPerAccountPerHour: z.number().int().positive().default(30),
    // The .bowman of a graph added from a remote URL.
    graphMegabytes: z.number().positive().default(50),
    // An account held only by a browser key, unused this many days, is
    // discarded with what it made: nobody can log into it any more anyway.
    idleAutomaticAccountDays: z.number().positive().default(180),
  }).prefault({}),
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

/** The directory that holds this server's spaces, one directory per space. */
export function spacesDir(): string {
  const configured = serverConfig().spacesDir;
  if (!configured) return path.join(serverDir(), 'spaces');
  return path.resolve(configured === '~' || configured.startsWith('~/') ? path.join(os.homedir(), configured.slice(1)) : configured);
}

/** True when other people use this server: accounts exist and nothing is taken on trust. */
export function hasAccounts(): boolean {
  return serverConfig().login === 'accounts';
}

/** Sets some settings and drops the ones named in `remove`, keeping the rest of the file (the setup of `pnpm start`, the server settings in the UI). */
export function updateServerConfig(values: z.input<typeof ServerConfigSchema>, remove: Array<keyof ServerConfig> = []) {
  const file = path.join(serverDir(), 'server.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const next = { ...current, ...values };
  for (const key of remove) delete next[key];
  ServerConfigSchema.parse(next);
  fs.mkdirSync(serverDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  forgetServerFile('server.json');
}
