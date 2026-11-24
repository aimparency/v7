import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedIdeas, priceUsage, usageByModel } from './record-session-cost.mjs';

const assistant = (id, model, usage) => JSON.stringify({ type: 'assistant', message: { id, model, usage } });

test('an API message spread over several transcript lines counts once', () => {
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 60 } };
  const lines = [assistant('m1', 'opus', usage), assistant('m1', 'opus', usage), assistant('m2', 'opus', usage), '{"type":"user"}', 'not json'];
  assert.deepEqual(usageByModel(lines), { opus: { input: 20, output: 10, cacheRead: 2000, cacheWrite: 80, cacheWrite1h: 120 } });
});

test('cache tokens without a cache price leave the cost unknown instead of too low', () => {
  const byModel = { opus: { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0, cacheWrite1h: 0 } };
  assert.deepEqual(priceUsage(byModel, { opus: { inputPerMTok: 1, outputPerMTok: 2 } }), { usd: 0, unpriced: ['opus'] });
  assert.deepEqual(priceUsage(byModel, { opus: { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0.5 } }), { usd: 3.5, unpriced: [] });
  assert.deepEqual(priceUsage(byModel, {}), { usd: 0, unpriced: ['opus'] });
});

test('the ideas a turn changed: committed since the last stop, and in the working tree', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cost-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.org');
  git('config', 'user.name', 'test');
  const idea = (id) => {
    fs.mkdirSync(path.join(repo, '.bowman', 'ideas'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.bowman', 'ideas', `${id}.json`), '{}');
  };
  const committed = '11111111-1111-4111-8111-111111111111';
  const uncommitted = '22222222-2222-4222-8222-222222222222';
  idea(committed);
  git('add', '.');
  git('commit', '-q', '-m', 'idea');
  idea(uncommitted);
  try {
    assert.deepEqual(changedIdeas(repo, new Date(Date.now() - 3_600_000).toISOString()).sort(), [committed, uncommitted]);
    assert.deepEqual(changedIdeas(repo, new Date(Date.now() + 3_600_000).toISOString()), [uncommitted], 'commits before the last stop do not count');
    // The recorder's own write (realizedCostUsd only) is no work of the turn.
    const later = new Date(Date.now() + 3_600_000).toISOString();
    fs.writeFileSync(path.join(repo, '.bowman', 'ideas', `${committed}.json`), JSON.stringify({ realizedCostUsd: 0.5 }));
    assert.deepEqual(changedIdeas(repo, later), [uncommitted]);
    // A reflection on a connection lands in the parent's file; the work was on the child.
    fs.writeFileSync(path.join(repo, '.bowman', 'ideas', `${committed}.json`), JSON.stringify({ supportingConnections: [{ ideaId: uncommitted, reflection: 'held' }] }));
    git('add', '.');
    git('commit', '-q', '-m', 'parent with connection');
    const afterCommit = new Date(Date.now() + 1000).toISOString();
    fs.writeFileSync(path.join(repo, '.bowman', 'ideas', `${committed}.json`), JSON.stringify({ supportingConnections: [{ ideaId: uncommitted, reflection: 'did not hold' }] }));
    assert.deepEqual(changedIdeas(repo, afterCommit), []);
    // A code-only commit that cites an idea (by its first 8 characters) counts for it.
    fs.writeFileSync(path.join(repo, 'code.ts'), 'x');
    git('add', 'code.ts');
    git('commit', '-q', '-m', `Fix the thing (${uncommitted.slice(0, 8)}), not 99999999`);
    assert.deepEqual(changedIdeas(repo, new Date(Date.now() - 60_000).toISOString()).includes(uncommitted), true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('1-hour cache writes take their own price', () => {
  const byModel = { opus: { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000 } };
  assert.deepEqual(priceUsage(byModel, { opus: { inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5 } }), { usd: 0, unpriced: ['opus'] });
  assert.deepEqual(priceUsage(byModel, { opus: { inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5, cacheWrite1hPerMTok: 8 } }), { usd: 13, unpriced: [] });
});
