import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'path';
import { appRouter } from './server';
import { clearIndices } from './search';
import type { ProjectMeta, LinkedRepoRegistry } from 'shared';

const caller = appRouter.createCaller({});

let testRootPath = '';
let projectAPath = ''; // the .bowman we register links INTO
let projectBPath = ''; // the sibling .bowman being linked

beforeEach(async () => {
  testRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-linked-test-'));
  projectAPath = path.join(testRootPath, 'repo-a', '.bowman');
  projectBPath = path.join(testRootPath, 'repo-b', '.bowman');
  await fs.ensureDir(projectAPath);
  await fs.ensureDir(projectBPath);
});

afterEach(async () => {
  await fs.remove(testRootPath);
  clearIndices(projectAPath);
  clearIndices(projectBPath);
});

const readMeta = (p: string) => fs.readJson(path.join(p, 'meta.json')) as Promise<ProjectMeta>;
const readRegistry = (p: string) =>
  fs.readJson(path.join(p, 'runtime', 'linked-repos.json')) as Promise<LinkedRepoRegistry>;

test('repoId is generated on first read and stays stable across reads', async () => {
  const first = await caller.project.getMeta({ graph: projectAPath });
  assert.ok(first.repoId, 'repoId should be generated');
  assert.match(first.repoId!, /^[0-9a-f-]{36}$/);

  // Persisted to disk...
  const onDisk = await readMeta(projectAPath);
  assert.equal(onDisk.repoId, first.repoId);

  // ...and stable on subsequent reads.
  const second = await caller.project.getMeta({ graph: projectAPath });
  assert.equal(second.repoId, first.repoId);
});

test('register splits portable (meta) and machine-local (runtime) parts', async () => {
  const registered = await caller.linkedRepo.register({
    graph: projectAPath,
    targetPath: projectBPath,
    url: 'https://example.com/repo-b.git',
  });

  const bMeta = await readMeta(projectBPath);
  assert.equal(registered.repoId, bMeta.repoId);
  assert.equal(registered.resolved, true);

  // Portable part lives in meta.json — and carries NO localPath.
  const aMeta = await readMeta(projectAPath);
  assert.equal(aMeta.linkedRepos?.length, 1);
  const link = aMeta.linkedRepos![0];
  assert.equal(link.repoId, bMeta.repoId);
  assert.equal(link.name, bMeta.name);
  assert.equal(link.url, 'https://example.com/repo-b.git');
  assert.equal((link as any).localPath, undefined, 'meta must not leak a machine-local path');

  // Machine-local part lives in the gitignored runtime registry, with the path.
  const registry = await readRegistry(projectAPath);
  assert.equal(registry.repos.length, 1);
  assert.equal(registry.repos[0].repoId, bMeta.repoId);
  assert.equal(registry.repos[0].localPath, projectBPath);
  assert.equal(registry.repos[0].access, 'read');
});

test('resolve performs two-stage repoId -> localPath lookup', async () => {
  const { repoId } = await caller.linkedRepo.register({
    graph: projectAPath,
    targetPath: projectBPath,
  });

  const resolved = await caller.linkedRepo.resolve({ graph: projectAPath, repoId });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.localPath, projectBPath);

  // An unknown repoId resolves to the not-checked-out state, not an error.
  const missing = await caller.linkedRepo.resolve({
    graph: projectAPath,
    repoId: '00000000-0000-4000-8000-000000000000',
  });
  assert.equal(missing.resolved, false);
  assert.equal(missing.localPath, undefined);
});

test('list reports a linked-but-unresolved repo when the local entry is gone', async () => {
  const { repoId } = await caller.linkedRepo.register({
    graph: projectAPath,
    targetPath: projectBPath,
  });

  // Simulate a collaborator who pulled meta.json but has no runtime registry.
  await fs.remove(path.join(projectAPath, 'runtime', 'linked-repos.json'));

  const list = await caller.linkedRepo.list({ graph: projectAPath });
  assert.equal(list.length, 1);
  assert.equal(list[0].repoId, repoId);
  assert.equal(list[0].resolved, false);
  assert.equal(list[0].localPath, undefined);
});

test('register rejects linking a repo to itself', async () => {
  await assert.rejects(
    () => caller.linkedRepo.register({ graph: projectAPath, targetPath: projectAPath }),
    /itself/i,
  );
});

test('register upserts rather than duplicating on re-register', async () => {
  await caller.linkedRepo.register({ graph: projectAPath, targetPath: projectBPath, access: 'read' });
  await caller.linkedRepo.register({ graph: projectAPath, targetPath: projectBPath, access: 'write' });

  const aMeta = await readMeta(projectAPath);
  assert.equal(aMeta.linkedRepos?.length, 1, 'no duplicate portable entry');

  const registry = await readRegistry(projectAPath);
  assert.equal(registry.repos.length, 1, 'no duplicate local entry');
  assert.equal(registry.repos[0].access, 'write', 'access updated');
});

test('unregister removes the link from both meta and the runtime registry', async () => {
  const { repoId } = await caller.linkedRepo.register({ graph: projectAPath, targetPath: projectBPath });

  await caller.linkedRepo.unregister({ graph: projectAPath, repoId });

  const aMeta = await readMeta(projectAPath);
  assert.equal(aMeta.linkedRepos?.length, 0);

  const registry = await readRegistry(projectAPath);
  assert.equal(registry.repos.length, 0);
});

test('linkHost stores a graph by its address on its server, with no checkout', async () => {
  const repoId = '22222222-2222-4222-8222-222222222222';
  const link = await caller.linkedRepo.linkHost({ graph: projectAPath, host: 'https://hub.example.org/g/commons-hub/', repoId, name: 'Commons Hub' });
  assert.deepStrictEqual(link, { repoId, name: 'Commons Hub', host: 'https://hub.example.org/g/commons-hub' });
  assert.deepStrictEqual((await readMeta(projectAPath)).linkedRepos, [link]);
  const [listed] = await caller.linkedRepo.list({ graph: projectAPath });
  assert.equal(listed!.host, link.host);
  assert.equal(listed!.resolved, false, 'not checked out here, and it need not be');

  // Registering a local checkout of the same graph later keeps its address.
  await fs.writeJson(path.join(projectBPath, 'meta.json'), { name: 'Commons Hub', repoId });
  await caller.linkedRepo.register({ graph: projectAPath, targetPath: projectBPath });
  assert.equal((await readMeta(projectAPath)).linkedRepos![0]!.host, link.host);
});

test('linkHost refuses what is not a graph address, and the graph itself', async () => {
  await assert.rejects(caller.linkedRepo.linkHost({ graph: projectAPath, host: 'https://hub.example.org/', repoId: '22222222-2222-4222-8222-222222222222', name: 'x' }));
  const self = await caller.project.getMeta({ graph: projectAPath });
  await assert.rejects(caller.linkedRepo.linkHost({ graph: projectAPath, host: 'https://hub.example.org/g/me', repoId: self.repoId!, name: 'me' }), /itself/);
});
