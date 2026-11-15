// How people get an account on a server with accounts: open sign-up, an
// invitation, or automatically with a key in their browser.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { webcrypto } from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import * as accounts from './accounts';
import { loginChallengeMessage } from 'shared';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
let addresses = 0;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-sign-up-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts' });
});

afterEach(async () => {
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

// One connection: its session is shared by all its calls, like a WebSocket's.
const connection = (address = `10.0.0.${++addresses}`) => appRouter.createCaller({ session: {}, address });
const as = (token: string) => appRouter.createCaller({ session: { token } });

// What the browser does: a P-256 key, its public half as SPKI, a signature over the challenge.
async function browserKey() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const sign = async (nonce: string) => Buffer.from(
    await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(loginChallengeMessage(nonce)))
  ).toString('base64');
  return { publicKey, sign };
}

test('logging in makes the same connection that account, logging out ends it', async () => {
  await accounts.createAccount('ada', 'ada password');
  const visitor = connection();
  assert.equal((await visitor.auth.me()).name, null);
  await assert.rejects(visitor.graphs.create({ name: 'Too early' }), /Log in first/);
  const { token } = await visitor.auth.login({ name: 'ada', password: 'ada password' });
  assert.equal((await visitor.auth.me()).name, 'ada');
  assert.equal((await visitor.graphs.create({ name: 'Mine' })).slug, 'mine');
  await visitor.auth.logout();
  assert.equal((await visitor.auth.me()).name, null);
  assert.equal(accounts.resolveToken(token), null, 'the token is gone, not only forgotten by the connection');
});

test('sign-up is closed unless the server opens it', async () => {
  const visitor = connection();
  await assert.rejects(visitor.auth.signUp({ name: 'ben', password: 'ben password' }), /needs an invitation/);
  updateServerConfig({ signUp: { open: true } });
  assert.deepEqual((await visitor.auth.me()).signUp, { open: true, browserKey: false, wallet: false });
  await visitor.auth.signUp({ name: 'ben', password: 'ben password' });
  assert.deepEqual(await visitor.auth.me().then(({ name, permanentLogin, serverAdmin }) => ({ name, permanentLogin, serverAdmin })),
    { name: 'ben', permanentLogin: true, serverAdmin: false });
  await assert.rejects(connection().auth.signUp({ name: 'ben', password: 'another password' }), /exists already/);
  await assert.rejects(connection().auth.signUp({ name: 'cleo', password: 'short' }), /at least 8 characters/);
});

test('an invitation lets its holder in: once, or until it ends', async () => {
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
  const admin = connection();
  await admin.auth.login({ name: 'admin', password: 'admin password' });
  await assert.rejects(connection().auth.createInvitation({ kind: 'once' }), /server admins/);

  const { code: once } = await admin.auth.createInvitation({ kind: 'once', canCreateGraphs: true });
  const { code: permanent } = await admin.auth.createInvitation({ kind: 'permanent', days: 7 });
  assert.ok(!(await fs.readFile(accounts.accountsFile(), 'utf8')).includes(once), 'only the hash of a code is stored');

  await connection().auth.signUp({ name: 'ben', password: 'ben password', invitation: once });
  assert.equal(accounts.findAccount('ben')?.canCreateGraphs, true);
  await assert.rejects(connection().auth.signUp({ name: 'cleo', password: 'cleo password', invitation: once }), /not valid any more/);
  await assert.rejects(connection().auth.signUp({ name: 'cleo', password: 'cleo password', invitation: 'made-up' }), /not valid any more/);

  await connection().auth.signUp({ name: 'cleo', password: 'cleo password', invitation: permanent });
  await connection().auth.signUp({ name: 'dan', password: 'dan password', invitation: permanent });
  const listed = await admin.auth.listInvitations();
  assert.deepEqual(listed.map(({ kind, redeemedBy, canCreateGraphs }) => ({ kind, redeemedBy, canCreateGraphs })), [
    { kind: 'once', redeemedBy: 'ben', canCreateGraphs: true },
    { kind: 'permanent', redeemedBy: null, canCreateGraphs: false }
  ]);
  assert.ok(Date.parse(listed[1]!.expiresAt!) > Date.now() + 6 * 24 * 60 * 60_000);

  await admin.auth.removeInvitation({ id: listed[1]!.id });
  await assert.rejects(connection().auth.signUp({ name: 'eve', password: 'eve password', invitation: permanent }), /not valid any more/);

  const expired = await accounts.createInvitation({ kind: 'permanent', expiresAt: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(connection().auth.signUp({ name: 'eve', password: 'eve password', invitation: expired }), /not valid any more/);
});

test('an invitation gives the rights of an account: server admin only for one person', async () => {
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
  const admin = connection();
  await admin.auth.login({ name: 'admin', password: 'admin password' });
  await assert.rejects(admin.auth.createInvitation({ kind: 'permanent', serverAdmin: true }), /for one person only/);

  const { code } = await admin.auth.createInvitation({ kind: 'once', serverAdmin: true });
  const [listed] = await admin.auth.listInvitations();
  assert.equal(listed!.serverAdmin, true);
  await connection().auth.signUp({ name: 'fay', password: 'fay password', invitation: code });
  assert.equal(accounts.findAccount('fay')?.serverAdmin, true);
  assert.notEqual(accounts.findAccount('fay')?.canCreateGraphs, true);
});

test('a visitor gets an account from the key in their browser, and later makes it permanent', async () => {
  updateServerConfig({ signUp: { browserKey: true } });
  const key = await browserKey();
  const visitor = connection();
  const { nonce } = await visitor.auth.keyChallenge();
  const signature = await key.sign(nonce);
  const { token } = await visitor.auth.keyLogin({ publicKey: key.publicKey, nonce, signature });
  const me = await visitor.auth.me();
  assert.match(me.name!, /^guest-[0-9a-f]{6}$/);
  assert.equal(me.permanentLogin, false);
  assert.equal((await visitor.graphs.create({ name: 'My idea' })).slug, 'my-idea');

  // A signed challenge works once.
  await assert.rejects(connection().auth.keyLogin({ publicKey: key.publicKey, nonce, signature }), /did not answer the challenge/);
  // The same key is the same account, from any connection.
  const again = connection();
  const second = await again.auth.keyChallenge();
  await again.auth.keyLogin({ publicKey: key.publicKey, nonce: second.nonce, signature: await key.sign(second.nonce) });
  assert.equal((await again.auth.me()).name, me.name);
  assert.equal(accounts.listAccounts().length, 1);

  // Someone else's signature is not this key's.
  const other = await browserKey();
  const third = await connection().auth.keyChallenge();
  await assert.rejects(connection().auth.keyLogin({ publicKey: key.publicKey, nonce: third.nonce, signature: await other.sign(third.nonce) }), /did not answer/);

  await visitor.auth.makePermanent({ name: 'Ana', password: 'ana password' });
  assert.deepEqual(await visitor.auth.me().then(({ name, permanentLogin }) => ({ name, permanentLogin })), { name: 'Ana', permanentLogin: true });
  assert.equal(accounts.resolveToken(token)?.name, 'Ana', 'the browser stays logged in');
  assert.equal((await as(token).graphs.list())[0]!.owner, 'Ana', 'what the account owned stays its own');
  await connection().auth.login({ name: 'Ana', password: 'ana password' });
  await assert.rejects(visitor.auth.makePermanent({ name: 'Ana', password: 'another password' }), /has a password already/);
});

test('a key gets no account where the server does not offer that', async () => {
  const key = await browserKey();
  const visitor = connection();
  const { nonce } = await visitor.auth.keyChallenge();
  await assert.rejects(visitor.auth.keyLogin({ publicKey: key.publicKey, nonce, signature: await key.sign(nonce) }), /gives no accounts automatically/);
  assert.equal(accounts.listAccounts().length, 0);
});

test('one address makes only so many accounts an hour, one account only so many graphs', async () => {
  updateServerConfig({ signUp: { open: true, browserKey: true }, limits: { accountsPerAddressPerHour: 2, graphsPerAccount: 1 } });
  const room = () => connection('192.0.2.7');
  const ben = room();
  await ben.auth.signUp({ name: 'ben', password: 'ben password' });
  const key = await browserKey();
  const guest = room();
  const { nonce } = await guest.auth.keyChallenge();
  await guest.auth.keyLogin({ publicKey: key.publicKey, nonce, signature: await key.sign(nonce) });
  await assert.rejects(room().auth.signUp({ name: 'cleo', password: 'cleo password' }), /Too many new accounts from this address/);
  // Logging in again with a known key makes no account, so it is not counted.
  const back = room();
  const next = await back.auth.keyChallenge();
  await back.auth.keyLogin({ publicKey: key.publicKey, nonce: next.nonce, signature: await key.sign(next.nonce) });

  await ben.graphs.create({ name: 'First' });
  await assert.rejects(ben.graphs.create({ name: 'Second' }), /at most 1 spaces/);
});
