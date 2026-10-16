// Accounts of a hosted instance: who may write the one project it serves.
// They live next to the graph, in the gitignored .bowman/runtime/, so a server
// admin manages them on the machine and git never carries them. Passwords are
// salted scrypt hashes; login tokens are random and stored as sha256 only.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { toBowmanPath } from 'shared';

export const ROLES = ['read', 'write', 'admin'] as const;
export type Role = typeof ROLES[number];

type User = { name: string; role: Role; passwordHash: string };
type Token = { hash: string; user: string; label: string; createdAt: string };
type Accounts = { users: User[]; tokens: Token[] };

const scrypt = promisify(crypto.scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export class AccountError extends Error {}

export const accountsFile = (projectPath: string) => path.join(toBowmanPath(projectPath), 'runtime', 'accounts.json');

export const roleAtLeast = (role: Role, needed: Role) => ROLES.indexOf(role) >= ROLES.indexOf(needed);

// Re-read when another process (the accounts CLI) changed the file.
const cache = new Map<string, { mtimeMs: number; accounts: Accounts }>();

async function load(projectPath: string): Promise<Accounts> {
  const file = accountsFile(projectPath);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return { users: [], tokens: [] };
  const cached = cache.get(file);
  if (cached?.mtimeMs === stat.mtimeMs) return cached.accounts;
  const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<Accounts>;
  const accounts = { users: parsed.users ?? [], tokens: parsed.tokens ?? [] };
  cache.set(file, { mtimeMs: stat.mtimeMs, accounts });
  return accounts;
}

async function save(projectPath: string, accounts: Accounts) {
  const file = accountsFile(projectPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // .bowman/.gitignore covers runtime/ only once the project was opened, and
  // the setup creates the first account before that: keep git out from here.
  await fs.writeFile(path.join(path.dirname(file), '.gitignore'), '*\n', { flag: 'wx' }).catch(() => undefined);
  await fs.writeFile(file, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 });
  cache.delete(file);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await scrypt(password, salt, KEY_LENGTH)).toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, KEY_LENGTH);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function findUser(accounts: Accounts, name: string): User {
  const user = accounts.users.find(candidate => candidate.name === name);
  if (!user) throw new AccountError(`No account named "${name}".`);
  return user;
}

function assertKeepsAnAdmin(accounts: Accounts) {
  if (!accounts.users.some(user => user.role === 'admin')) {
    throw new AccountError('The last admin cannot be removed or demoted.');
  }
}

function assertPassword(password: string) {
  if (password.length < 8) throw new AccountError('A password needs at least 8 characters.');
}

export async function listUsers(projectPath: string): Promise<Array<{ name: string; role: Role }>> {
  return (await load(projectPath)).users.map(({ name, role }) => ({ name, role }));
}

export async function createUser(projectPath: string, name: string, role: Role, password: string) {
  const accounts = await load(projectPath);
  const trimmed = name.trim();
  if (!trimmed) throw new AccountError('An account needs a name.');
  if (accounts.users.some(user => user.name === trimmed)) throw new AccountError(`"${trimmed}" exists already.`);
  assertPassword(password);
  const user = { name: trimmed, role, passwordHash: await hashPassword(password) };
  await save(projectPath, { ...accounts, users: [...accounts.users, user] });
}

export async function setPassword(projectPath: string, name: string, password: string) {
  const accounts = await load(projectPath);
  findUser(accounts, name);
  assertPassword(password);
  const passwordHash = await hashPassword(password);
  await save(projectPath, {
    users: accounts.users.map(user => user.name === name ? { ...user, passwordHash } : user),
    // A new password logs out everywhere else.
    tokens: accounts.tokens.filter(token => token.user !== name)
  });
}

export async function setRole(projectPath: string, name: string, role: Role) {
  const accounts = await load(projectPath);
  findUser(accounts, name);
  const next = { ...accounts, users: accounts.users.map(user => user.name === name ? { ...user, role } : user) };
  assertKeepsAnAdmin(next);
  await save(projectPath, next);
}

export async function removeUser(projectPath: string, name: string) {
  const accounts = await load(projectPath);
  findUser(accounts, name);
  const next = {
    users: accounts.users.filter(user => user.name !== name),
    tokens: accounts.tokens.filter(token => token.user !== name)
  };
  assertKeepsAnAdmin(next);
  await save(projectPath, next);
}

// A wrong name or password look the same from outside.
export async function checkPassword(projectPath: string, name: string, password: string): Promise<boolean> {
  const user = (await load(projectPath)).users.find(candidate => candidate.name === name);
  return user ? passwordMatches(password, user.passwordHash) : false;
}

export async function login(projectPath: string, name: string, password: string): Promise<string | null> {
  return await checkPassword(projectPath, name, password) ? issueToken(projectPath, name, 'browser') : null;
}

export async function issueToken(projectPath: string, name: string, label: string): Promise<string> {
  const accounts = await load(projectPath);
  findUser(accounts, name);
  const token = crypto.randomBytes(32).toString('base64url');
  const entry = { hash: sha256(token), user: name, label, createdAt: new Date().toISOString() };
  await save(projectPath, { ...accounts, tokens: [...accounts.tokens, entry] });
  return token;
}

export async function revokeToken(projectPath: string, token: string) {
  const accounts = await load(projectPath);
  const hash = sha256(token);
  await save(projectPath, { ...accounts, tokens: accounts.tokens.filter(entry => entry.hash !== hash) });
}

export async function resolveToken(projectPath: string, token: string | undefined): Promise<{ name: string; role: Role } | null> {
  if (!token) return null;
  const accounts = await load(projectPath);
  const entry = accounts.tokens.find(candidate => candidate.hash === sha256(token));
  const user = entry && accounts.users.find(candidate => candidate.name === entry.user);
  return user ? { name: user.name, role: user.role } : null;
}
