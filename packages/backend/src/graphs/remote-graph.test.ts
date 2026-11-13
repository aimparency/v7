// Graphs added from a Git URL: cloned through a closed git environment,
// read-only until their owner selects one of their own keys, then pushed back.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import * as accounts from '../auth/accounts';
import { pullFastForward } from '../git-follow';
import { listGraphs } from './registry';
import { addRemote } from './remote-graph';
import { graphGitEnv, isInternalAddress, remoteGitEnv } from './remote-git';

let root = '';
let upstream = '';
let author = '';
let url = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString().trim();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-remote-'));
  process.env.AIMPARENCY_SERVER_DIR = path.join(root, 'server');
  updateServerConfig({ login: 'accounts' });
  upstream = path.join(root, 'plans.git');
  author = path.join(root, 'author');
  url = `file://${upstream}`;
  git(root, 'init', '-q', '--bare', '-b', 'main', upstream);
  git(root, 'clone', '-q', upstream, author);
  await fs.outputJson(path.join(author, '.bowman', 'meta.json'), { name: 'Plans', color: '#336699', dataModelVersion: 6, rootPhaseIds: [] });
  await fs.outputFile(path.join(author, 'src', 'code.ts'), 'export {}');
  git(author, 'add', '-A');
  git(author, 'commit', '-qm', 'init');
  git(author, 'push', '-q', 'origin', 'HEAD:main');
});

afterEach(async () => {
  for (const graph of listGraphs()) clearIndices(graph.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const loggedIn = async (name: string) => appRouter.createCaller({ session: { token: (await accounts.login(name, `${name} password`))! } });

test('a remote graph is read-only until its owner selects a key, then commits are pushed back', async () => {
  const ana = await accounts.createAccount('ana', 'ana password');
  await accounts.createAccount('ben', 'ben password');
  const graph = await addRemote(url, ana.id, { allowFileUrls: true });
  assert.equal(graph.slug, 'plans');
  assert.equal(await fs.pathExists(path.join(graph.path, 'src', 'code.ts')), false, 'only the .bowman is cloned');

  const caller = await loggedIn('ana');
  const idea = { projectPath: 'plans', idea: { text: 'From the server' } };
  await assert.rejects(caller.idea.createFloatingIdea(idea), /open read-only/);
  assert.deepEqual(await caller.project.getAccess({ projectPath: 'plans' }).then(({ writable, role }) => ({ writable, role })), { writable: false, role: 'owner' });

  // Only public halves leave the server, and a key is its account's alone.
  const key = await caller.keys.create({ label: 'plans on GitHub' });
  assert.match(key.publicKey, /^ssh-ed25519 \S+ plans on GitHub$/);
  assert.deepEqual(await caller.keys.list(), [key]);
  const ben = await loggedIn('ben');
  assert.deepEqual(await ben.keys.list(), []);
  await assert.rejects(ben.graphs.setRemoteKey({ projectPath: 'plans', key: key.id }), /open read-only for ben/);
  const benKey = await ben.keys.create({ label: 'mine' });
  await assert.rejects(caller.graphs.setRemoteKey({ projectPath: 'plans', key: benKey.id }), /one of your own keys/);
  await assert.rejects(caller.graphs.setRemoteKey({ projectPath: 'plans', key: '../../etc' }), /one of your own keys/);

  await caller.graphs.setRemoteKey({ projectPath: 'plans', key: key.id });
  assert.deepEqual((await caller.graphs.getAccess({ projectPath: 'plans' }))?.remote, { url, key: key.id, keyOwner: 'ana' });
  const stored = JSON.stringify(await caller.graphs.getAccess({ projectPath: 'plans' })) + JSON.stringify(await caller.keys.list());
  assert.ok(!stored.includes('PRIVATE KEY') && !stored.includes(path.join(root, 'server')), 'neither the private key nor its file is shown');

  await caller.idea.createFloatingIdea(idea);
  const status = await caller.git.status({ projectPath: 'plans' });
  const changed = status.isRepository ? status.changes.map(change => change.path) : [];
  await caller.git.commit({ projectPath: 'plans', paths: changed, message: 'An idea from the server' });
  assert.deepEqual(await caller.git.push({ projectPath: 'plans' }), { pushed: 1 });
  assert.equal(git(upstream, 'log', '-1', '--format=%s', 'main'), 'An idea from the server');

  // What is pushed elsewhere arrives here, through the graph's own git environment.
  git(author, 'pull', '-q', 'origin', 'main');
  await fs.outputJson(path.join(author, '.bowman', 'meta.json'), { name: 'Renamed upstream', color: '#336699', dataModelVersion: 6, rootPhaseIds: [] });
  git(author, 'commit', '-qam', 'rename');
  git(author, 'push', '-q', 'origin', 'HEAD:main');
  const current = listGraphs()[0]!;
  assert.equal((await pullFastForward(path.join(current.path, '.bowman'), await graphGitEnv(current))).state, 'updated');
  assert.equal((await caller.project.getMeta({ projectPath: 'plans' })).name, 'Renamed upstream');

  // Without the key it follows its remote again and nobody edits it here.
  await caller.graphs.setRemoteKey({ projectPath: 'plans', key: null });
  await assert.rejects(caller.idea.createFloatingIdea(idea), /open read-only/);
  await caller.keys.remove({ id: key.id });
  assert.deepEqual(await caller.keys.list(), []);

  await caller.graphs.remove({ projectPath: 'plans' });
  assert.equal(await fs.pathExists(current.path), false);
});

test('what a visitor enters is fetched only from public https and ssh addresses', async () => {
  await accounts.createAccount('ana', 'ana password');
  const caller = await loggedIn('ana');
  await assert.rejects(appRouter.createCaller({ session: {} }).graphs.addRemote({ url: 'https://github.com/aimparency/v7.git' }), /Log in first/);
  for (const refused of [url, '/etc', 'ext::sh -c id', 'http://example.org/repo.git']) {
    await assert.rejects(caller.graphs.addRemote({ url: refused }), /Not a Git URL|Only https and ssh/, refused);
  }
  for (const internal of ['https://127.0.0.1/repo.git', 'https://localhost/repo.git', 'ssh://git@192.168.1.10/repo.git', 'https://[::1]/repo.git', 'git@10.0.0.5:team/repo.git']) {
    await assert.rejects(caller.graphs.addRemote({ url: internal }), /not a public address/, internal);
  }
  assert.deepEqual(listGraphs(), []);
  for (const address of ['10.1.2.3', '172.20.0.1', '169.254.169.254', '100.100.100.100', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.ok(isInternalAddress(address), address);
  }
  assert.equal(isInternalAddress('140.82.121.4'), false);
});

test('git for a remote uses nothing of the server user: no agent, no config, only the selected key', async () => {
  process.env.SSH_AUTH_SOCK = '/run/user/1000/agent';
  try {
    const env = await remoteGitEnv('ssh://git@203.0.113.9/team/repo.git', '/srv/keys/one');
    assert.equal(env.SSH_AUTH_SOCK, undefined);
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(env.GIT_ALLOW_PROTOCOL, 'https:ssh');
    assert.match(env.GIT_SSH_COMMAND!, /'IdentitiesOnly=yes'.*'IdentityAgent=none'.*'-i' '\/srv\/keys\/one'.*'HostName=203\.0\.113\.9'/);
    const config = Object.fromEntries(Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, index) => [env[`GIT_CONFIG_KEY_${index}`], env[`GIT_CONFIG_VALUE_${index}`]]));
    assert.deepEqual(config, { 'core.hooksPath': '/dev/null', 'http.followRedirects': 'false', 'credential.helper': '' });

    const https = await remoteGitEnv('https://203.0.113.9/team/repo.git', null);
    assert.match(https.GIT_SSH_COMMAND!, /'IdentityFile=none'/);
    assert.equal(https.GIT_CONFIG_VALUE_3, '203.0.113.9:443:203.0.113.9', 'git is pinned to the address that was checked');
  } finally {
    delete process.env.SSH_AUTH_SOCK;
  }
});

test('a graph larger than the server allows is not kept', async () => {
  const ana = await accounts.createAccount('ana', 'ana password');
  updateServerConfig({ limits: { graphMegabytes: 0.001 } });
  await fs.outputFile(path.join(author, '.bowman', 'ideas', 'big.json'), 'x'.repeat(5000));
  git(author, 'add', '-A');
  git(author, 'commit', '-qm', 'big');
  git(author, 'push', '-q', 'origin', 'HEAD:main');
  await assert.rejects(addRemote(url, ana.id, { allowFileUrls: true }), /larger than the 0.001 MB/);
  assert.deepEqual(listGraphs(), []);
  assert.equal(await fs.pathExists(path.join(root, 'server', 'remotes', 'plans')), false);
});
