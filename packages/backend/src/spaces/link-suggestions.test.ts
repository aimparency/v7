import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { rankSuggestions, readSelfDescription } from './link-suggestions';

test('another space is read only by its subtitle and its three most valued ideas', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'self-description-'));
  try {
    const bowman = path.join(root, 'kitchen', '.bowman');
    await fs.ensureDir(path.join(bowman, 'ideas'));
    await fs.writeJson(path.join(bowman, 'meta.json'), { name: 'Kitchen', subtitle: 'Cooking for the hub', repoId: 'k' });
    const ideas = [['a', 'Soup every Friday', 5], ['b', 'Bread', 9], ['c', 'Knives', 1], ['d', 'Pots', 3], ['e', 'Internal detail', 0]] as const;
    for (const [id, text, intrinsicValue] of ideas) await fs.writeJson(path.join(bowman, 'ideas', `${id}.json`), { text, intrinsicValue });
    assert.deepEqual(await readSelfDescription(bowman), {
      path: path.join(root, 'kitchen'), name: 'Kitchen', repoId: 'k', lines: ['Cooking for the hub', 'Bread', 'Soup every Friday', 'Pots']
    });

    // Without an id it cannot be linked; saying nothing, it is not suggested.
    await fs.writeJson(path.join(bowman, 'meta.json'), { name: 'Kitchen' });
    assert.equal(await readSelfDescription(bowman), null);
  } finally {
    await fs.remove(root);
  }
});

test('suggestions: the best line per space, at most a few spaces per idea, above the threshold, best first', () => {
  const space = (name: string) => ({ path: `/${name}`, name, repoId: name });
  const suggestions = rankSuggestions(
    [{ id: 'i1', text: 'Feed the volunteers', vector: [1, 0] }, { id: 'i2', text: 'Fix the roof', vector: [0, 1] }],
    [
      { space: space('kitchen'), lines: [{ text: 'Cooking', vector: [0.9, 0.1] }, { text: 'Bread', vector: [0.6, 0.4] }] },
      { space: space('workshop'), lines: [{ text: 'Repairs', vector: [0.2, 0.95] }] }
    ],
    { minScore: 0.5 }
  );
  assert.deepEqual(suggestions.map(s => [s.ideaId, s.space.name, s.line, s.score]), [
    ['i2', 'workshop', 'Repairs', 0.95],
    ['i1', 'kitchen', 'Cooking', 0.9]
  ]);
});
