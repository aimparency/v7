// Accounts and rights of a server with `"login": "accounts"`: accounts belong
// to the server, rights to each graph.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import { addCheckout, listGraphs } from '../graphs/registry';
import * as accounts from './accounts';

let root = '';
let projectPath = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-auth-'));
  projectPath = path.join(root, 'repo', '.bowman');
  await fs.ensureDir(projectPath);
  process.env.AIMPARENCY_SERVER_DIR = path.join(root, 'server');
});

afterEach(async () => {
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  clearIndices(projectPath);
  await fs.remove(root);
});

// The repository becomes the graph "shared" of a server with accounts.
const host = async (owner: string | null = null) => {
  updateServerConfig({ login: 'accounts' });
  await addCheckout(path.dirname(projectPath), owner, 'shared');
};
const shared = 'shared';

const as = (token?: string) => appRouter.createCaller({ session: { token } });
const loggedIn = async (name: string, password: string) => as((await accounts.login(name, password))!);

test('passwords and tokens round-trip, and a revoked token is gone', async () => {
  const ada = await accounts.createAccount('ada', 'correct horse');
  assert.equal(await accounts.login('ada', 'wrong password'), null);
  const token = await accounts.login('ada', 'correct horse');
  assert.ok(token);
  assert.deepEqual(accounts.resolveToken(token), { id: ada.id, name: 'ada', serverAdmin: false, canCreateGraphs: false, permanentLogin: true, scope: null });
  await accounts.revokeToken(token);
  assert.equal(accounts.resolveToken(token), null);
  const stored = await fs.readFile(accounts.accountsFile(), 'utf8');
  assert.ok(!stored.includes('correct horse'));
  assert.ok(!stored.includes(token), 'only the hash of a token is stored');
  // In the server directory, readable by the server's user only; no .bowman holds accounts.
  assert.equal(accounts.accountsFile(), path.join(root, 'server', 'accounts.json'));
  assert.equal((await fs.stat(accounts.accountsFile())).mode & 0o777, 0o600);
});

test('the last server admin can be neither removed nor demoted', async () => {
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
  await assert.rejects(accounts.setRights('admin', { serverAdmin: false }), /last server admin/);
  await assert.rejects(accounts.removeAccount('admin'), /last server admin/);
  await accounts.createAccount('second', 'second password', { serverAdmin: true });
  await accounts.setRights('second', { canCreateGraphs: true });
  await accounts.removeAccount('admin');
  assert.deepEqual(accounts.listAccounts().map(({ name, serverAdmin, canCreateGraphs }) => ({ name, serverAdmin, canCreateGraphs })),
    [{ name: 'second', serverAdmin: true, canCreateGraphs: true }]);
});

test('everyone reads a graph, its owner and writers change it, the server admin manages accounts', async () => {
  const phase = await as().phase.create({ projectPath, phase: { name: 'Now' } }) as { id: string };
  const idea = await as().idea.createIdeaInPhase({ projectPath, phaseId: phase.id, idea: { text: 'Shared' } });
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
  const owner = await accounts.createAccount('owner', 'owner password');
  await accounts.createAccount('writer', 'writer password');
  await accounts.createAccount('stranger', 'stranger password');
  await host(owner.id);

  const guest = as();
  assert.equal((await guest.idea.list({ projectPath: shared })).length, 1);
  assert.deepEqual(await guest.project.getAccess({ projectPath: shared }), {
    writable: false, reason: 'This graph is open read-only here: log in to edit.', user: null, role: 'read', serverAdmin: false
  });
  const edit = (text: string) => ({ projectPath: shared, ideaId: idea.id, idea: { text } });
  await assert.rejects(guest.idea.update(edit('Guest edit')), /open read-only/);
  // Re-indexing costs the server and activity is shown to every viewer: not for guests.
  await assert.rejects(guest.project.buildSearchIndex({ projectPath: shared }), /open read-only/);
  await assert.rejects(guest.activity.record({ projectPath: shared, ideaIds: [idea.id], kind: 'read' }), /open read-only/);
  await assert.rejects(guest.idea.searchSemantic({ projectPath: shared, query: 'x'.repeat(2001) }));

  const stranger = await loggedIn('stranger', 'stranger password');
  await assert.rejects(stranger.idea.update(edit('Stranger edit')), /open read-only for stranger: ask its owner/);

  const ownerCaller = await loggedIn('owner', 'owner password');
  await ownerCaller.idea.update(edit('Owner edit'));
  assert.equal((await ownerCaller.project.getAccess({ projectPath: shared })).role, 'owner');
  await ownerCaller.graphs.setAccess({ projectPath: shared, writers: ['writer'] });
  const { slug, kind, owner: ownedBy, writers } = (await guest.graphs.getAccess({ projectPath: shared }))!;
  assert.deepEqual({ slug, kind, ownedBy, writers }, { slug: 'shared', kind: 'checkout', ownedBy: 'owner', writers: ['writer'] });
  await assert.rejects(ownerCaller.graphs.setAccess({ projectPath: shared, writers: ['nobody'] }), /No account named "nobody"/);

  const writer = await loggedIn('writer', 'writer password');
  await writer.idea.update(edit('Writer edit'));
  assert.equal((await guest.idea.get({ projectPath: shared, ideaId: idea.id })).text, 'Writer edit');
  // Write access covers the whole graph, its settings included; who may use it stays the owner's.
  await writer.project.updateMeta({ projectPath: shared, meta: { name: 'Renamed', color: '#123456' } });
  await assert.rejects(writer.graphs.setAccess({ projectPath: shared, writers: [] }), /Only the owner/);
  await assert.rejects(writer.graphs.remove({ projectPath: shared }), /Only the owner/);
  await assert.rejects(writer.auth.createAccount({ name: 'friend', password: 'friend password' }), /server admins/);
  await assert.rejects(writer.auth.listAccounts(), /server admins/);

  const admin = await loggedIn('admin', 'admin password');
  await admin.auth.createAccount({ name: 'friend', password: 'friend password' });
  assert.deepEqual((await admin.auth.listAccounts()).map(account => account.name), ['admin', 'owner', 'writer', 'stranger', 'friend']);
  await admin.idea.update(edit('Admin edit'));
});

test('with accounts a graph is named by its slug, never by a path, and local tools are off', async () => {
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
  await host();
  const admin = await loggedIn('admin', 'admin password');
  await assert.rejects(admin.idea.list({ projectPath }), /addressed by their name, not by a path/);
  await assert.rejects(as().idea.list({ projectPath: path.join(os.tmpdir(), 'elsewhere') }), /addressed by their name/);
  await assert.rejects(admin.idea.list({ projectPath: 'unknown' }), /No graph "unknown"/);
  await assert.rejects(admin.project.inspectPath({ projectPath: shared }), /not available on a server with accounts/);
  await assert.rejects(admin.project.discoverLocalProjects(), /not available on a server with accounts/);
  await assert.rejects(admin.loop.getConfig({ projectPath: shared }), /not available on a server with accounts/);
  await assert.rejects(admin.linkedRepo.register({ projectPath: shared, targetPath: '/etc' }), /not available on a server with accounts/);
});

test('without login the person at the machine may do everything, by path or by slug', async () => {
  await addCheckout(path.dirname(projectPath), null, 'mine');
  const idea = await as().idea.createFloatingIdea({ projectPath: 'mine', idea: { text: 'By slug' } });
  assert.equal((await as().idea.get({ projectPath, ideaId: idea.id })).text, 'By slug');
  assert.deepEqual(await as().auth.me(), {
    login: 'none', publicUrl: null, agents: false, signUp: { open: false, browserKey: false, wallet: false }, name: null, serverAdmin: true, canCreateGraphs: true, permanentLogin: true
  });
  assert.equal((await as().project.getAccess({ projectPath })).role, 'owner');
  await assert.rejects(as().auth.login({ name: 'x', password: 'whatever it is' }), /no accounts/);
});

test('an account creates a graph in one step and owns it', async () => {
  updateServerConfig({ login: 'accounts' });
  await accounts.createAccount('ada', 'ada password');
  await accounts.createAccount('bob', 'bob password');
  const ada = await loggedIn('ada', 'ada password');
  const bob = await loggedIn('bob', 'bob password');
  await assert.rejects(as().graphs.create({ name: 'Anonymous' }), /Log in first/);

  const { slug } = await ada.graphs.create({ name: 'Hack the Hub!' });
  assert.equal(slug, 'hack-the-hub');
  assert.equal((await ada.graphs.create({ name: 'Hack the hub' })).slug, 'hack-the-hub-2');
  const directory = path.join(root, 'server', 'graphs', slug);
  assert.ok(await fs.pathExists(path.join(directory, '.git')), 'a repository of its own');
  assert.deepEqual((await as().graphs.list()).map(({ slug, name, owner, kind }) => ({ slug, name, owner, kind })), [
    { slug: 'hack-the-hub', name: 'Hack the Hub!', owner: 'ada', kind: 'created' },
    { slug: 'hack-the-hub-2', name: 'Hack the hub', owner: 'ada', kind: 'created' }
  ]);

  await ada.idea.createFloatingIdea({ projectPath: slug, idea: { text: 'Build something' } });
  await assert.rejects(bob.idea.createFloatingIdea({ projectPath: slug, idea: { text: 'Mine too' } }), /open read-only for bob/);
  assert.equal((await bob.idea.list({ projectPath: slug })).length, 1);

  // The owner's first commit, as the server's git author when git has none.
  const status = await ada.git.status({ projectPath: slug });
  assert.ok(status.isRepository && !('repositoryPath' in status), 'the directory on the server is not shown');
  const changed = status.isRepository ? status.changes.map(change => change.path) : [];
  assert.ok((await ada.git.commit({ projectPath: slug, paths: changed, message: 'Start' })).commit);
  await assert.rejects(bob.git.commit({ projectPath: slug, paths: [], message: 'No' }), /open read-only/);

  await assert.rejects(bob.graphs.remove({ projectPath: slug }), /open read-only/);
  await ada.graphs.remove({ projectPath: slug });
  assert.equal(await fs.pathExists(directory), false);
  assert.deepEqual(listGraphs().map(graph => graph.slug), ['hack-the-hub-2']);

  updateServerConfig({ graphCreation: 'selected' });
  await assert.rejects(bob.graphs.create({ name: 'Not selected' }), /accounts the server admin selected/);
  await accounts.setRights('bob', { canCreateGraphs: true });
  assert.equal((await bob.graphs.create({ name: 'Selected' })).slug, 'selected');
});

test('a graph sends only its own changes, under its own address', async () => {
  updateServerConfig({ login: 'accounts' });
  await accounts.createAccount('ada', 'ada password');
  const ada = await loggedIn('ada', 'ada password');
  const first = (await ada.graphs.create({ name: 'First' })).slug;
  const second = (await ada.graphs.create({ name: 'Second' })).slug;
  const seen: Array<{ type: string; projectPath: string }> = [];
  const updates = await as().project.onUpdate({ projectPath: first });
  const subscription = updates.subscribe({ next: event => seen.push({ type: event.type, projectPath: event.projectPath }) });
  await ada.idea.createFloatingIdea({ projectPath: second, idea: { text: 'Elsewhere' } });
  await ada.idea.createFloatingIdea({ projectPath: first, idea: { text: 'Here' } });
  subscription.unsubscribe();
  assert.deepEqual(seen, [{ type: 'idea', projectPath: 'first' }]);
});

test('a token limited to some graphs is the account there and nobody anywhere else', async () => {
  updateServerConfig({ login: 'accounts' });
  await accounts.createAccount('ada', 'ada password', { serverAdmin: true });
  const ada = await loggedIn('ada', 'ada password');
  const first = (await ada.graphs.create({ name: 'First' })).slug;
  const second = (await ada.graphs.create({ name: 'Second' })).slug;
  await assert.rejects(ada.auth.issueToken({ label: 'agent', graphs: ['unknown'] }), /No graph "unknown"/);
  const { token } = await ada.auth.issueToken({ label: 'agent', graphs: [first] });
  const agent = as(token);

  await agent.idea.createFloatingIdea({ projectPath: first, idea: { text: 'In scope' } });
  assert.deepEqual(await agent.project.getAccess({ projectPath: first }).then(({ user, role, serverAdmin }) => ({ user, role, serverAdmin })),
    { user: 'ada', role: 'owner', serverAdmin: false });
  // The other graph is ada's too, and she is the server admin: the token is neither.
  assert.equal((await agent.idea.list({ projectPath: second })).length, 0);
  await assert.rejects(agent.idea.createFloatingIdea({ projectPath: second, idea: { text: 'Out of scope' } }), /log in to edit/);
  await assert.rejects(agent.graphs.create({ name: 'More' }), /Log in first/);
  await assert.rejects(agent.auth.issueToken({ label: 'wider' }), /Log in first/);
  await assert.rejects(agent.auth.listAccounts(), /server admins/);
  assert.equal((await agent.auth.me()).name, null);

  // The account sees what it handed out and takes it back.
  const tokens = await ada.auth.listTokens();
  assert.deepEqual(tokens.map(({ label, graphs }) => ({ label, graphs })), [{ label: 'browser', graphs: null }, { label: 'agent', graphs: [first] }]);
  assert.ok(!JSON.stringify(tokens).includes(token));
  await ada.auth.revokeOwnToken({ id: tokens[1]!.id });
  await assert.rejects(agent.idea.createFloatingIdea({ projectPath: first, idea: { text: 'Revoked' } }), /log in to edit/);
  await assert.rejects(as().auth.listTokens(), /Log in first/);
});

test('a wrong password is refused', async () => {
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
  await host();
  await assert.rejects(as().auth.login({ name: 'admin', password: 'nope' }), /Wrong name or password/);
});

test('the wrapped agents write as their own account, and each start replaces their token', async () => {
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
  const first = await accounts.agentToken();
  assert.equal(accounts.resolveToken(first)?.name, accounts.AGENTS_ACCOUNT);
  assert.equal(accounts.resolveToken(first)?.serverAdmin, false);

  const second = await accounts.agentToken();
  assert.equal(accounts.resolveToken(first), null, 'the previous start\'s token is gone');
  assert.equal(accounts.listAccounts().filter(account => account.name === accounts.AGENTS_ACCOUNT).length, 1);

  await host();
  // Like any account: it writes the graphs it was given, and no others.
  await assert.rejects(as(second).idea.createFloatingIdea({ projectPath: shared, idea: { text: 'Not yet' } }), /open read-only/);
  await (await loggedIn('admin', 'admin password')).graphs.setAccess({ projectPath: shared, writers: [accounts.AGENTS_ACCOUNT] });
  assert.ok(await as(second).idea.createFloatingIdea({ projectPath: shared, idea: { text: 'Written by an agent' } }));
  await assert.rejects(as(second).auth.createAccount({ name: 'x', password: 'long enough pw', serverAdmin: true }), /server admins/);
});

test('a writer cannot reach files outside the graph through history.restore', async () => {
  const writer = await accounts.createAccount('writer', 'writer password');
  await host(writer.id);
  const outside = path.join(root, 'repo', 'outside.json');
  await fs.writeJson(outside, { keep: true });
  await assert.rejects((await loggedIn('writer', 'writer password')).history.restore({
    projectPath: shared,
    changes: [{ type: 'idea', id: '../../outside', expected: { keep: true }, target: null }]
  }), /UUID/);
  assert.deepEqual(await fs.readJson(outside), { keep: true });
});

test('wrong passwords for one name pause its logins', async () => {
  await accounts.createAccount('target', 'the right password', { serverAdmin: true });
  await host();
  const guesses = Array.from({ length: 10 }, (_, index) =>
    assert.rejects(as().auth.login({ name: 'target', password: `guess ${index}` }), /Wrong name or password/));
  await Promise.all(guesses);
  await assert.rejects(as().auth.login({ name: 'target', password: 'the right password' }), /Too many wrong passwords/);
});
