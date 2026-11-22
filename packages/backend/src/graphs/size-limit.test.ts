// A space created on a server with accounts may not grow past limits.graphMegabytes.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import * as accounts from '../auth/accounts';
import { findGraph, graphBowmanPath, listGraphs } from './registry';
import { directoryBytes } from './size-limit';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-size-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', graphCreation: 'everyone' } as never);
});

afterEach(async () => {
  for (const graph of listGraphs()) clearIndices(graph.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

test('a space past the size limit takes no more changes, but things can still be removed from it', async () => {
  await accounts.createAccount('ana', 'ana password');
  const ana = appRouter.createCaller({ session: { token: (await accounts.login('ana', 'ana password'))! } });
  const slug = (await ana.graphs.create({ name: 'Kitchen' })).slug;
  const bytes = await directoryBytes(graphBowmanPath(findGraph(slug)!), ['cache', 'runtime']);
  updateServerConfig({ limits: { graphMegabytes: (bytes + 2000) / 1024 / 1024 } } as never);

  const big = await ana.idea.createFloatingIdea({ graph: slug, idea: { text: 'Big', description: 'x'.repeat(5000) } });
  await assert.rejects(ana.idea.createFloatingIdea({ graph: slug, idea: { text: 'One more' } }), /larger than the .* MB a space may have/);
  await ana.idea.delete({ graph: slug, ideaIds: [big.id] });
  await ana.idea.createFloatingIdea({ graph: slug, idea: { text: 'Fits again' } });
});
