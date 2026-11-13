// Login by signing with a crypto wallet (Sign-In with Ethereum), checked by this server alone.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import * as accounts from './accounts';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
const publicUrl = 'https://graphs.example.org';
let addresses = 0;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-wallet-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', publicUrl, signUp: { open: true, wallet: true } });
});

afterEach(async () => {
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const connection = () => appRouter.createCaller({ session: {}, address: `10.1.0.${++addresses}` });
const wallet = () => privateKeyToAccount(generatePrivateKey());

async function signIn(caller: ReturnType<typeof connection>, signer: ReturnType<typeof wallet>) {
  const { message } = await caller.auth.walletChallenge({ address: signer.address, chainId: 1 });
  return { message, signature: await signer.signMessage({ message }) };
}

test('a wallet signs the message this server wrote and is logged in; an unknown one gets an account', async () => {
  const signer = wallet();
  const visitor = connection();
  assert.equal((await visitor.auth.me()).signUp.wallet, true);
  const signed = await signIn(visitor, signer);
  assert.match(signed.message, /^graphs\.example\.org wants you to sign in with your Ethereum account:/);
  await visitor.auth.walletLogin(signed);
  const me = await visitor.auth.me();
  assert.equal(me.name, `${signer.address.slice(0, 6)}…${signer.address.slice(-4)}`);
  assert.equal(me.permanentLogin, true, 'a wallet is a permanent login');

  // A signed message works once.
  await assert.rejects(connection().auth.walletLogin(signed), /does not fit the message this server wrote/);
  // The same wallet is the same account.
  const again = connection();
  await again.auth.walletLogin(await signIn(again, signer));
  assert.equal((await again.auth.me()).name, me.name);
  assert.equal(accounts.listAccounts().length, 1);
});

test('a signature for another website, or by another wallet, is refused', async () => {
  const signer = wallet();
  const visitor = connection();
  const { message } = await visitor.auth.walletChallenge({ address: signer.address, chainId: 1 });

  // Someone else's wallet signing this wallet's message.
  await assert.rejects(visitor.auth.walletLogin({ message, signature: await wallet().signMessage({ message }) }), /does not fit/);

  // The same words under another domain, as a phishing page would show them: this server never wrote that.
  const fresh = await visitor.auth.walletChallenge({ address: signer.address, chainId: 1 });
  const phished = fresh.message.replace('graphs.example.org wants', 'evil.example wants');
  await assert.rejects(visitor.auth.walletLogin({ message: phished, signature: await signer.signMessage({ message: phished }) }), /does not fit/);
  assert.equal(accounts.listAccounts().length, 0);
});

test('where sign-up is closed only wallets of existing accounts log in; an account adds its wallet', async () => {
  updateServerConfig({ signUp: { open: false, wallet: true } });
  const signer = wallet();
  const visitor = connection();
  await assert.rejects(visitor.auth.walletLogin(await signIn(visitor, signer)), /No account on this server logs in with this wallet/);

  await accounts.createAccount('ana', 'ana password');
  const ana = connection();
  await ana.auth.login({ name: 'ana', password: 'ana password' });
  await ana.auth.addWallet(await signIn(ana, signer));
  const back = connection();
  await back.auth.walletLogin(await signIn(back, signer));
  assert.equal((await back.auth.me()).name, 'ana');

  await accounts.createAccount('ben', 'ben password');
  const ben = connection();
  await ben.auth.login({ name: 'ben', password: 'ben password' });
  await assert.rejects(ben.auth.addWallet(await signIn(ben, signer)), /logs in another account already/);
  await assert.rejects(connection().auth.addWallet(await signIn(connection(), wallet())), /Log in first/);
});

test('without the server knowing its own address there is no wallet login', async () => {
  await fs.writeJson(path.join(root, 'server.json'), { login: 'accounts', signUp: { open: true, wallet: true } });
  const visitor = connection();
  assert.equal((await visitor.auth.me()).signUp.wallet, false);
  await assert.rejects(visitor.auth.walletChallenge({ address: wallet().address, chainId: 1 }), /offers no login with a wallet/);
});
