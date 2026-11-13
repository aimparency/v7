// Accounts of a server with `"login": "accounts"`. They belong to the server,
// not to a graph: accounts.json in the server directory, never in a .bowman, so
// git never carries them. Passwords are salted scrypt hashes; login tokens are
// random and stored as sha256 only. What an account may do on a graph is the
// graph's business (graphs/registry.ts); here are only the two server-wide
// rights: server admin, and whether it may create graphs.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { forgetServerFile, readServerFile, serverDir } from 'shared/server-config';
import { withFileLock } from '../storage/json.js';

type Account = {
  id: string;
  name: string;
  passwordHash?: string;
  serverAdmin?: boolean;
  canCreateGraphs?: boolean;
  createdAt: string;
};
type Token = { hash: string; account: string; label: string; createdAt: string };
type Accounts = { accounts: Account[]; tokens: Token[] };

export type AccountView = { id: string; name: string; serverAdmin: boolean; canCreateGraphs: boolean };

const FILE = 'accounts.json';
const scrypt = promisify(crypto.scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const MAX_NAME_LENGTH = 60;

export class AccountError extends Error {}

export const accountsFile = () => path.join(serverDir(), FILE);

function load(): Accounts {
  return readServerFile(FILE, (raw) => {
    const parsed = (raw ?? {}) as Partial<Accounts>;
    return { accounts: parsed.accounts ?? [], tokens: parsed.tokens ?? [] };
  });
}

// One change at a time, each on the file as it is now.
async function change(update: (accounts: Accounts) => Accounts | Promise<Accounts>): Promise<void> {
  const file = accountsFile();
  await withFileLock(file, async () => {
    forgetServerFile(FILE);
    const next = await update(load());
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(temporary, file);
    forgetServerFile(FILE);
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await scrypt(password, salt, KEY_LENGTH)).toString('hex')}`;
}

async function passwordMatches(password: string, stored: string | undefined): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? '').split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, KEY_LENGTH);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const view = ({ id, name, serverAdmin, canCreateGraphs }: Account): AccountView =>
  ({ id, name, serverAdmin: serverAdmin === true, canCreateGraphs: canCreateGraphs === true });

function byName(accounts: Accounts, name: string): Account {
  const account = accounts.accounts.find(candidate => candidate.name === name);
  if (!account) throw new AccountError(`No account named "${name}".`);
  return account;
}

const hasAdmin = (accounts: Accounts) => accounts.accounts.some(account => account.serverAdmin);

function assertKeepsAnAdmin(before: Accounts, after: Accounts) {
  if (hasAdmin(before) && !hasAdmin(after)) throw new AccountError('The last server admin cannot be removed or demoted.');
}

function assertPassword(password: string) {
  if (password.length < 8) throw new AccountError('A password needs at least 8 characters.');
}

export function listAccounts(): AccountView[] {
  return load().accounts.map(view);
}

/** The account of this name, or null. */
export function findAccount(name: string): AccountView | null {
  const account = load().accounts.find(candidate => candidate.name === name);
  return account ? view(account) : null;
}

/** Names of the accounts with these ids; ids of removed accounts are left out. */
export function accountNames(ids: string[]): string[] {
  const names = new Map(load().accounts.map(account => [account.id, account.name]));
  return ids.flatMap(id => names.get(id) ?? []);
}

export async function createAccount(
  name: string,
  password: string,
  rights: { serverAdmin?: boolean; canCreateGraphs?: boolean } = {}
): Promise<AccountView> {
  const trimmed = name.trim();
  if (!trimmed) throw new AccountError('An account needs a name.');
  if (trimmed.length > MAX_NAME_LENGTH) throw new AccountError(`A name has at most ${MAX_NAME_LENGTH} characters.`);
  assertPassword(password);
  const account: Account = {
    id: crypto.randomUUID(),
    name: trimmed,
    passwordHash: await hashPassword(password),
    ...(rights.serverAdmin ? { serverAdmin: true } : {}),
    ...(rights.canCreateGraphs ? { canCreateGraphs: true } : {}),
    createdAt: new Date().toISOString()
  };
  await change((accounts) => {
    if (accounts.accounts.some(existing => existing.name === trimmed)) throw new AccountError(`"${trimmed}" exists already.`);
    return { ...accounts, accounts: [...accounts.accounts, account] };
  });
  return view(account);
}

export async function setPassword(name: string, password: string) {
  assertPassword(password);
  const passwordHash = await hashPassword(password);
  await change((accounts) => {
    const { id } = byName(accounts, name);
    return {
      accounts: accounts.accounts.map(account => account.id === id ? { ...account, passwordHash } : account),
      // A new password logs out everywhere else.
      tokens: accounts.tokens.filter(token => token.account !== id)
    };
  });
}

export async function setRights(name: string, rights: { serverAdmin?: boolean; canCreateGraphs?: boolean }) {
  // Only what was named changes: an absent right keeps its value.
  const changed = Object.fromEntries(Object.entries(rights).filter(([, value]) => value !== undefined));
  await change((accounts) => {
    const { id } = byName(accounts, name);
    const next = {
      ...accounts,
      accounts: accounts.accounts.map(account => account.id === id ? { ...account, ...changed } : account)
    };
    assertKeepsAnAdmin(accounts, next);
    return next;
  });
}

export async function removeAccount(name: string) {
  await change((accounts) => {
    const { id } = byName(accounts, name);
    const next = {
      accounts: accounts.accounts.filter(account => account.id !== id),
      tokens: accounts.tokens.filter(token => token.account !== id)
    };
    assertKeepsAnAdmin(accounts, next);
    return next;
  });
}

// A wrong name or password look the same from outside.
export async function checkPassword(name: string, password: string): Promise<boolean> {
  const account = load().accounts.find(candidate => candidate.name === name);
  return account ? passwordMatches(password, account.passwordHash) : false;
}

export async function login(name: string, password: string): Promise<string | null> {
  return await checkPassword(name, password) ? issueToken(name, 'browser') : null;
}

export async function issueToken(name: string, label: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await change((accounts) => {
    const entry = { hash: sha256(token), account: byName(accounts, name).id, label, createdAt: new Date().toISOString() };
    return { ...accounts, tokens: [...accounts.tokens, entry] };
  });
  return token;
}

export async function revokeToken(token: string) {
  const hash = sha256(token);
  await change(accounts => ({ ...accounts, tokens: accounts.tokens.filter(entry => entry.hash !== hash) }));
}

export function resolveToken(token: string | undefined): AccountView | null {
  if (!token) return null;
  const accounts = load();
  const entry = accounts.tokens.find(candidate => candidate.hash === sha256(token));
  const account = entry && accounts.accounts.find(candidate => candidate.id === entry.account);
  return account ? view(account) : null;
}

// The server admins' wrapped agents edit graphs through the MCP as this account
// (never a server admin): it writes the graphs it was given, like any account.
// Each start replaces its token, so an old one stops working.
export const AGENTS_ACCOUNT = 'wrapped-agents';

export async function agentToken(): Promise<string> {
  if (!findAccount(AGENTS_ACCOUNT)) {
    await createAccount(AGENTS_ACCOUNT, crypto.randomBytes(24).toString('base64url'));
  }
  const { id } = findAccount(AGENTS_ACCOUNT)!;
  await change(accounts => ({ ...accounts, tokens: accounts.tokens.filter(token => token.account !== id) }));
  return issueToken(AGENTS_ACCOUNT, 'agents');
}
