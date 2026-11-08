import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cycleCostUsd, spentTodayUsd, unpricedModels } from './costs.js';
import { tracesDir } from './traces.js';

const stage = (model: string, inputTokens: number, outputTokens: number) => ({
  model: { provider: 'openrouter' as const, model, baseUrl: 'x' },
  usage: { inputTokens, outputTokens }
});
const prices = { cheap: { inputPerMTok: 0.5, outputPerMTok: 1.5 }, strong: { inputPerMTok: 3, outputPerMTok: 15 } };

test('a cycle costs the sum of its stages at each stage model price; one unpriced model makes it unknown', () => {
  const stages = [stage('cheap', 1_000_000, 200_000), stage('strong', 100_000, 10_000)];
  assert.equal(cycleCostUsd(stages, prices), 0.5 + 0.3 + 0.3 + 0.15);
  assert.equal(cycleCostUsd([...stages, stage('mystery', 1, 1)], prices), null);
  assert.deepEqual(unpricedModels([...stages, stage('mystery', 1, 1), stage('mystery', 2, 2)], prices), ['mystery']);
  assert.equal(cycleCostUsd([], prices), 0);
});

test('spent today sums only priced traces that started today (UTC)', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'costs-'));
  const dir = tracesDir(projectPath);
  await fs.mkdir(dir, { recursive: true });
  const write = (name: string, costUsd: number | null) => fs.writeFile(path.join(dir, name), JSON.stringify({ costUsd }));
  await write('2026-11-08T09-00-00-000Z-aaaaaaaa.json', 0.25);
  await write('2026-11-08T10-00-00-000Z-bbbbbbbb.json', null);
  await write('2026-11-08T11-00-00-000Z-cccccccc.json', 0.5);
  await write('2026-11-07T23-59-59-000Z-dddddddd.json', 9);
  assert.equal(await spentTodayUsd(projectPath, new Date('2026-11-08T20:00:00Z')), 0.75);
  assert.equal(await spentTodayUsd(path.join(projectPath, 'nowhere')), 0);
});
