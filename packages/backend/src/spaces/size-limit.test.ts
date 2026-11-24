// A space created on a server with accounts may not grow past limits.spaceMegabytes.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import * as accounts from '../auth/accounts';
import { findSpace, spaceBowmanPath, listSpaces } from './registry';
import { directoryBytes } from './size-limit';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-size-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', spaceCreation: 'everyone' } as never);
});

afterEach(async () => {
  for (const space of listSpaces()) clearIndices(space.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

test('a space past the size limit takes no more changes, but things can still be removed from it', async () => {
  await accounts.createAccount('ana', 'ana password');
  const ana = appRouter.createCaller({ session: { token: (await accounts.login('ana', 'ana password'))! } });
  const slug = (await ana.spaces.create({ name: 'Kitchen' })).slug;
  const bytes = await directoryBytes(spaceBowmanPath(findSpace(slug)!), ['cache', 'runtime']);
  updateServerConfig({ limits: { spaceMegabytes: (bytes + 2000) / 1024 / 1024 } } as never);

  const big = await ana.idea.createFloatingIdea({ space: slug, idea: { text: 'Big', description: 'x'.repeat(5000) } });
  await assert.rejects(ana.idea.createFloatingIdea({ space: slug, idea: { text: 'One more' } }), /larger than the .* MB a space may have/);
  await ana.idea.delete({ space: slug, ideaIds: [big.id] });
  await ana.idea.createFloatingIdea({ space: slug, idea: { text: 'Fits again' } });
});
