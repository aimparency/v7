// A checkout whose folder moved: the list says so, and its operator points the
// entry at the new folder. Another space there is taken only on purpose.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { addCheckout, findSpace, relocateCheckout } from './registry';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-relocate-'));
  process.env.AIMPARENCY_SERVER_DIR = path.join(root, 'server');
  updateServerConfig({ login: 'none' });
});

afterEach(async () => {
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const space = async (folder: string, repoId: string) => {
  await fs.ensureDir(path.join(root, folder, '.bowman'));
  await fs.writeJson(path.join(root, folder, '.bowman', 'meta.json'), { name: folder, repoId });
  return path.join(root, folder);
};

test('a moved checkout is listed as missing and pointed at its new folder', async () => {
  const kitchen = await space('kitchen', 'kitchen-id');
  const added = await addCheckout(kitchen, null, 'kitchen');
  assert.equal(added.repoId, 'kitchen-id');

  await fs.move(kitchen, path.join(root, 'archive', 'kitchen'));
  const caller = appRouter.createCaller({});
  assert.equal((await caller.spaces.list()).find(listed => listed.slug === 'kitchen')?.missing, true);

  const other = await space('garden', 'garden-id');
  await assert.rejects(relocateCheckout('kitchen', other), /holds another space/);
  await relocateCheckout('kitchen', path.join(root, 'archive', 'kitchen', '.bowman'));
  assert.equal(findSpace('kitchen')?.path, path.join(root, 'archive', 'kitchen'));
  assert.equal((await caller.spaces.list()).find(listed => listed.slug === 'kitchen')?.missing, undefined);

  await relocateCheckout('kitchen', other, { force: true });
  assert.equal(findSpace('kitchen')?.repoId, 'garden-id', 'taken on purpose, it is that space now');
  await assert.rejects(relocateCheckout('kitchen', path.join(root, 'nowhere')), /No space/);
});
