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
  /** Absent on an account that so far only has its browser key. */
  passwordHash?: string;
  /** The browser key of an automatic account: its public half (SPKI, base64). */
  publicKey?: string;
  /** Wallet addresses (checksummed) that log this account in. */
  wallets?: string[];
  serverAdmin?: boolean;
  canCreateGraphs?: boolean;
  createdAt: string;
  /** Its person deleted it: logged out everywhere; logging in again within ACCOUNT_DELETION_DAYS brings it back, then it is discarded. */
  deletedAt?: string;
  /** The day the account last did anything (a request, a login): kept to the day. */
  lastActiveAt?: string;
};
// `graphs`: the slugs this token is limited to (an MCP client the account gave
// only some graphs); absent, the token is the account everywhere.
// `site`: the origin of another website whose pages the account let act as it
// here (auth.grantSite); such a token works from that website's pages only.
type Token = { hash: string; account: string; label: string; createdAt: string; graphs?: string[]; site?: string };
// A link that lets its holder create an account; `once` is used up by the first.
type Invitation = {
  id: string;
  hash: string;
  kind: 'once' | 'permanent';
  expiresAt?: string;
  // The rights the account made with it gets, as set for an existing account.
  serverAdmin?: boolean;
  canCreateGraphs?: boolean;
  // An invitation to one space, made by its owner: whoever takes it (a new
  // account, or one that exists) reads or writes that space.
  grant?: InvitationGrant;
  invitedBy?: string;
  redeemedBy?: string;
  createdAt: string;
};
export type InvitationGrant = { graph: string; right: 'read' | 'write' | 'manage' };
type Accounts = { accounts: Account[]; tokens: Token[]; invitations: Invitation[] };

export type AccountView = {
  id: string;
  name: string;
  serverAdmin: boolean;
  canCreateGraphs: boolean;
  /** False while the account lives only in one browser: clearing that browser loses it. */
  permanentLogin: boolean;
};

const FILE = 'accounts.json';
const scrypt = promisify(crypto.scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const MAX_NAME_LENGTH = 60;

export class AccountError extends Error {}

export const accountsFile = () => path.join(serverDir(), FILE);

function load(): Accounts {
  return readServerFile(FILE, (raw) => {
    const parsed = (raw ?? {}) as Partial<Accounts>;
    return { accounts: parsed.accounts ?? [], tokens: parsed.tokens ?? [], invitations: parsed.invitations ?? [] };
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

const view = ({ id, name, serverAdmin, canCreateGraphs, passwordHash, wallets }: Account): AccountView => ({
  id, name, serverAdmin: serverAdmin === true, canCreateGraphs: canCreateGraphs === true,
  permanentLogin: passwordHash !== undefined || (wallets?.length ?? 0) > 0
});

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

export function listAccounts(): (AccountView & { deletedAt?: string })[] {
  return load().accounts.map(account => ({ ...view(account), ...(account.deletedAt ? { deletedAt: account.deletedAt } : {}) }));
}

export const ACCOUNT_DELETION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Its person deletes the account: every login of it ends (browsers, agents,
 * websites), and it is discarded ACCOUNT_DELETION_DAYS later unless they log
 * in again before. Not for server admins: another admin removes them, or demotes them first.
 */
export async function scheduleDeletion(id: string, now = Date.now()): Promise<{ purgeAt: string }> {
  const deletedAt = new Date(now).toISOString();
  await change((accounts) => {
    const account = accounts.accounts.find(candidate => candidate.id === id);
    if (!account) throw new AccountError('No such account.');
    if (account.serverAdmin) throw new AccountError('A server admin cannot delete their own account: another server admin removes it, or takes the admin right away first.');
    return {
      ...accounts,
      accounts: accounts.accounts.map(candidate => candidate.id === id ? { ...candidate, deletedAt } : candidate),
      tokens: accounts.tokens.filter(token => token.account !== id)
    };
  });
  return { purgeAt: new Date(now + ACCOUNT_DELETION_DAYS * DAY_MS).toISOString() };
}

/** Logging in brings a deleted account back; whether it was deleted. */
export async function cancelDeletion(name: string): Promise<boolean> {
  if (!load().accounts.find(candidate => candidate.name === name)?.deletedAt) return false;
  await change(accounts => ({
    ...accounts,
    accounts: accounts.accounts.map(candidate => {
      if (candidate.name !== name) return candidate;
      const { deletedAt: _restored, ...kept } = candidate;
      return kept;
    })
  }));
  return true;
}

/** Accounts deleted longer than ACCOUNT_DELETION_DAYS ago: to be discarded. */
export function expiredDeletedAccounts(now = Date.now()): string[] {
  return load().accounts
    .filter(account => account.deletedAt && Date.parse(account.deletedAt) + ACCOUNT_DELETION_DAYS * DAY_MS <= now)
    .map(account => account.id);
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

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new AccountError('An account needs a name.');
  if (trimmed.length > MAX_NAME_LENGTH) throw new AccountError(`A name has at most ${MAX_NAME_LENGTH} characters.`);
  return trimmed;
}

function assertFreeName(accounts: Accounts, name: string, except?: string) {
  if (accounts.accounts.some(existing => existing.name === name && existing.id !== except)) {
    throw new AccountError(`"${name}" exists already.`);
  }
}

const newAccount = (name: string, fields: Partial<Account>): Account =>
  ({ id: crypto.randomUUID(), name, ...fields, createdAt: new Date().toISOString() });

export async function createAccount(
  name: string,
  password: string,
  rights: { serverAdmin?: boolean; canCreateGraphs?: boolean } = {}
): Promise<AccountView> {
  const trimmed = cleanName(name);
  assertPassword(password);
  const account = newAccount(trimmed, {
    passwordHash: await hashPassword(password),
    ...(rights.serverAdmin ? { serverAdmin: true } : {}),
    ...(rights.canCreateGraphs ? { canCreateGraphs: true } : {})
  });
  await change((accounts) => {
    assertFreeName(accounts, trimmed);
    return { ...accounts, accounts: [...accounts.accounts, account] };
  });
  return view(account);
}

// --- Invitations ---------------------------------------------------------------

function validInvitation(accounts: Accounts, code: string): Invitation {
  const invitation = accounts.invitations.find(candidate => candidate.hash === sha256(code));
  const expired = invitation?.expiresAt !== undefined && Date.parse(invitation.expiresAt) < Date.now();
  if (!invitation || expired || invitation.redeemedBy) throw new AccountError('This invitation is not valid any more.');
  return invitation;
}

/** The code to hand out (in a link); only its hash is stored. */
export async function createInvitation(
  options: { kind: 'once' | 'permanent'; expiresAt?: string; serverAdmin?: boolean; canCreateGraphs?: boolean; grant?: InvitationGrant; invitedBy?: string }
): Promise<string> {
  // Server admin is a shell on the server: never for whoever holds a shared link.
  if (options.serverAdmin && options.kind !== 'once') {
    throw new AccountError('An invitation that makes a server admin is for one person only.');
  }
  const code = crypto.randomBytes(18).toString('base64url');
  const invitation: Invitation = {
    id: crypto.randomUUID(),
    hash: sha256(code),
    kind: options.kind,
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    ...(options.serverAdmin ? { serverAdmin: true } : {}),
    ...(options.canCreateGraphs ? { canCreateGraphs: true } : {}),
    ...(options.grant ? { grant: options.grant } : {}),
    ...(options.invitedBy ? { invitedBy: options.invitedBy } : {}),
    createdAt: new Date().toISOString()
  };
  await change(accounts => ({ ...accounts, invitations: [...accounts.invitations, invitation] }));
  return code;
}

export function listInvitations() {
  const accounts = load();
  const names = new Map(accounts.accounts.map(account => [account.id, account.name]));
  return accounts.invitations.map(({ id, kind, expiresAt, serverAdmin, canCreateGraphs, grant, invitedBy, redeemedBy, createdAt }) => ({
    id, kind, createdAt,
    expiresAt: expiresAt ?? null,
    serverAdmin: serverAdmin === true,
    canCreateGraphs: canCreateGraphs === true,
    grant: grant ?? null,
    invitedBy: invitedBy ? names.get(invitedBy) ?? '(removed account)' : null,
    // A redeemed one-time invitation stays listed, so the admin sees who came through it.
    redeemedBy: redeemedBy ? names.get(redeemedBy) ?? '(removed account)' : null
  }));
}

export async function removeInvitation(id: string) {
  await change(accounts => ({ ...accounts, invitations: accounts.invitations.filter(invitation => invitation.id !== id) }));
}

/** What a valid invitation gives on a space; null for an invitation to the server only. Throws for an invalid one. */
export function invitationGrant(code: string): InvitationGrant | null {
  return validInvitation(load(), code).grant ?? null;
}

/**
 * An account that exists takes an invitation to a space: a one-time
 * invitation is used up by it. Invitations to the server only make accounts.
 */
export async function redeemInvitation(code: string, accountId: string): Promise<InvitationGrant> {
  let grant!: InvitationGrant;
  await change((accounts) => {
    const invited = validInvitation(accounts, code);
    if (!invited.grant) throw new AccountError('This invitation makes a new account; you have one already.');
    grant = invited.grant;
    return {
      ...accounts,
      invitations: accounts.invitations.map(candidate =>
        candidate === invited && candidate.kind === 'once' ? { ...candidate, redeemedBy: accountId } : candidate)
    };
  });
  return grant;
}

/** A person makes their own account: where sign-up is open, or with an invitation. */
export async function signUp(name: string, password: string, { open, invitation }: { open: boolean; invitation?: string }): Promise<AccountView> {
  const trimmed = cleanName(name);
  assertPassword(password);
  const passwordHash = await hashPassword(password);
  let account!: Account;
  await change((accounts) => {
    const invited = invitation ? validInvitation(accounts, invitation) : null;
    if (!invited && !open) throw new AccountError('Creating an account on this server needs an invitation.');
    assertFreeName(accounts, trimmed);
    account = newAccount(trimmed, {
      passwordHash,
      ...(invited?.serverAdmin ? { serverAdmin: true } : {}),
      ...(invited?.canCreateGraphs ? { canCreateGraphs: true } : {})
    });
    return {
      ...accounts,
      accounts: [...accounts.accounts, account],
      invitations: accounts.invitations.map(candidate =>
        candidate === invited && candidate.kind === 'once' ? { ...candidate, redeemedBy: account.id } : candidate)
    };
  });
  return view(account);
}

// --- Automatic accounts, held by a key in the browser ----------------------------

export function findAccountByKey(publicKey: string): AccountView | null {
  const account = load().accounts.find(candidate => candidate.publicKey === publicKey);
  return account ? view(account) : null;
}

/** An account nobody typed anything for: named after its key until its holder chooses a name. */
export async function createKeyAccount(publicKey: string): Promise<AccountView> {
  const digest = sha256(publicKey);
  let account!: Account;
  await change((accounts) => {
    const existing = accounts.accounts.find(candidate => candidate.publicKey === publicKey);
    if (existing) {
      account = existing;
      return accounts;
    }
    let length = 6;
    while (accounts.accounts.some(candidate => candidate.name === `guest-${digest.slice(0, length)}`)) length++;
    account = newAccount(`guest-${digest.slice(0, length)}`, { publicKey });
    return { ...accounts, accounts: [...accounts.accounts, account] };
  });
  return view(account);
}

// --- Wallets ---------------------------------------------------------------------

export function findAccountByWallet(address: string): AccountView | null {
  const account = load().accounts.find(candidate => candidate.wallets?.includes(address));
  return account ? view(account) : null;
}

/** An account for a wallet nobody knows yet, named after its address until its holder chooses a name. */
export async function createWalletAccount(address: string): Promise<AccountView> {
  let account!: Account;
  await change((accounts) => {
    const existing = accounts.accounts.find(candidate => candidate.wallets?.includes(address));
    if (existing) {
      account = existing;
      return accounts;
    }
    let length = 4;
    const name = () => `${address.slice(0, 6)}…${address.slice(-length)}`;
    while (accounts.accounts.some(candidate => candidate.name === name())) length++;
    account = newAccount(name(), { wallets: [address] });
    return { ...accounts, accounts: [...accounts.accounts, account] };
  });
  return view(account);
}

/** Lets this wallet log the account in from now on. */
export async function addWallet(name: string, address: string) {
  await change((accounts) => {
    const current = byName(accounts, name);
    if (accounts.accounts.some(account => account.id !== current.id && account.wallets?.includes(address))) {
      throw new AccountError('This wallet logs in another account already.');
    }
    const wallets = [...new Set([...(current.wallets ?? []), address])];
    return { ...accounts, accounts: accounts.accounts.map(account => account.id === current.id ? { ...account, wallets } : account) };
  });
}

/** The first permanent login of an automatic account: a name of its own and a password. Logins stay. */
export async function makePermanent(name: string, newName: string, password: string) {
  const trimmed = cleanName(newName);
  assertPassword(password);
  const passwordHash = await hashPassword(password);
  await change((accounts) => {
    const current = byName(accounts, name);
    if (current.passwordHash) throw new AccountError('This account has a password already.');
    assertFreeName(accounts, trimmed, current.id);
    return {
      ...accounts,
      accounts: accounts.accounts.map(account => account.id === current.id ? { ...account, name: trimmed, passwordHash } : account)
    };
  });
}

export async function setPassword(name: string, password: string) {
  assertPassword(password);
  const passwordHash = await hashPassword(password);
  await change((accounts) => {
    const { id } = byName(accounts, name);
    return {
      ...accounts,
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

// An account only its browser key logs into: losing the key loses it.
const isAutomatic = (account: Account) => account.passwordHash === undefined && (account.wallets?.length ?? 0) === 0 && !account.serverAdmin;

export function isAutomaticAccount(id: string): boolean {
  const account = load().accounts.find(candidate => candidate.id === id);
  return account !== undefined && isAutomatic(account);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Notes that the account was active today: written at most once a day. */
export async function touchAccount(id: string) {
  const account = load().accounts.find(candidate => candidate.id === id);
  if (!account || account.lastActiveAt === today()) return;
  await change(accounts => ({
    ...accounts,
    accounts: accounts.accounts.map(candidate => candidate.id === id ? { ...candidate, lastActiveAt: today() } : candidate)
  }));
}

/** Automatic accounts unused since before `days` days ago. */
export function idleAutomaticAccounts(days: number, now = Date.now()): string[] {
  const before = new Date(now - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return load().accounts
    .filter(account => isAutomatic(account) && (account.lastActiveAt ?? account.createdAt.slice(0, 10)) < before)
    .map(account => account.id);
}

export async function removeAccountById(id: string) {
  await change((accounts) => {
    const next = {
      ...accounts,
      accounts: accounts.accounts.filter(account => account.id !== id),
      tokens: accounts.tokens.filter(token => token.account !== id)
    };
    assertKeepsAnAdmin(accounts, next);
    return next;
  });
}

export async function removeAccount(name: string) {
  await change((accounts) => {
    const { id } = byName(accounts, name);
    const next = {
      ...accounts,
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

export async function issueToken(name: string, label: string, graphs?: string[], site?: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await change((accounts) => {
    const entry: Token = {
      hash: sha256(token), account: byName(accounts, name).id, label, createdAt: new Date().toISOString(),
      ...(graphs ? { graphs } : {}),
      ...(site ? { site } : {})
    };
    // A login is activity.
    const active = accounts.accounts.map(account => account.id === entry.account ? { ...account, lastActiveAt: today() } : account);
    // A website gets one login per account: granting again replaces the old one.
    const kept = site ? accounts.tokens.filter(other => !(other.account === entry.account && other.site === site)) : accounts.tokens;
    return { ...accounts, accounts: active, tokens: [...kept, entry] };
  });
  return token;
}

/**
 * A space that is gone for good: tokens limited to it no longer name it, so a
 * later space under the same slug is not theirs. A token left with no space is revoked.
 */
export async function forgetGraphsInTokens(slugs: readonly string[]) {
  const gone = new Set(slugs);
  if (!load().tokens.some(token => token.graphs?.some(slug => gone.has(slug)))) return;
  await change(accounts => ({
    ...accounts,
    tokens: accounts.tokens.flatMap((token) => {
      if (!token.graphs?.some(slug => gone.has(slug))) return [token];
      const graphs = token.graphs.filter(slug => !gone.has(slug));
      return graphs.length ? [{ ...token, graphs }] : [];
    })
  }));
}

export async function revokeToken(token: string) {
  const hash = sha256(token);
  await change(accounts => ({ ...accounts, tokens: accounts.tokens.filter(entry => entry.hash !== hash) }));
}

/** The account a token logs in, the graphs it is limited to (null: none, it is the account everywhere), and the website it was granted to. */
export function resolveToken(token: string | undefined): (AccountView & { scope: string[] | null; site: string | null }) | null {
  if (!token) return null;
  const accounts = load();
  const entry = accounts.tokens.find(candidate => candidate.hash === sha256(token));
  const account = entry && accounts.accounts.find(candidate => candidate.id === entry.account);
  return account ? { ...view(account), scope: entry.graphs ?? null, site: entry.site ?? null } : null;
}

// The tokens an account handed out (browsers it is logged in at, MCP clients),
// named by the start of their hash: enough to revoke one, useless to log in.
const TOKEN_ID_LENGTH = 16;

export function listTokens(name: string) {
  const accounts = load();
  const { id } = byName(accounts, name);
  return accounts.tokens.filter(token => token.account === id)
    .map(({ hash, label, createdAt, graphs, site }) => ({ id: hash.slice(0, TOKEN_ID_LENGTH), label, createdAt, graphs: graphs ?? null, site: site ?? null }));
}

export async function revokeTokenById(name: string, tokenId: string) {
  await change((accounts) => {
    const { id } = byName(accounts, name);
    return { ...accounts, tokens: accounts.tokens.filter(token => !(token.account === id && token.hash.slice(0, TOKEN_ID_LENGTH) === tokenId)) };
  });
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
