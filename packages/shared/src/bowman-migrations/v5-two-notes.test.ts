import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateIdeaNotes, migrateReflectionPrompts, migrateTwoNotes, needsTwoNotesMigration } from './v5-two-notes.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'data-model-v4');
const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const ARCHIVED_ID = '44444444-4444-4444-8444-444444444444';

async function copyFixture(): Promise<string> {
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'bowman-v5-')), '.bowman');
  await fs.cp(FIXTURE, target, { recursive: true });
  return target;
}

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

test('idea reflections fold into the status comment and connection evaluation becomes reflection', () => {
  const migrated = migrateIdeaNotes({
    id: 'x',
    status: { state: 'implemented', comment: 'done', date: 1 },
    reflection: '  tests green  ',
    reflections: [{ date: 1, context: 'restates the idea', outcome: 'shipped', effectiveness: '', lesson: 'test first' }],
    supportingConnections: [
      { ideaId: 'a', hypothesis: 'h', evaluation: 'held' },
      { ideaId: 'b', evaluation: 'stale', reflection: 'written by new code' }
    ]
  }) as any;

  assert.equal(migrated.status.comment, 'done\n\ntests green\n\nOutcome: shipped Lesson: test first');
  assert.equal('reflection' in migrated, false);
  assert.equal('reflections' in migrated, false);
  assert.deepStrictEqual(migrated.supportingConnections, [
    { ideaId: 'a', hypothesis: 'h', reflection: 'held' },
    { ideaId: 'b', reflection: 'written by new code' }
  ]);
  assert.deepStrictEqual(migrateIdeaNotes(migrated), migrated, 'a migrated idea stays as it is');
});

test('promptsEvaluation becomes promptsReflection; a configured promptsReflection wins', () => {
  const migrated = migrateReflectionPrompts({
    statuses: [{ key: 'open' }, { key: 'implemented', promptsEvaluation: true }, { key: 'failed', promptsEvaluation: true, promptsReflection: false }]
  }) as any;
  assert.deepStrictEqual(migrated.statuses, [{ key: 'open' }, { key: 'implemented', promptsReflection: true }, { key: 'failed', promptsReflection: false }]);
});

test('the v4 fixture migrates, a second run changes nothing, and legacy notes brought back are pending again', async () => {
  const bowman = await copyFixture();
  const file = (dir: string, id: string) => path.join(bowman, dir, `${id}.json`);
  assert.equal(await needsTwoNotesMigration(bowman), true);

  await migrateTwoNotes(bowman);
  const root = await readJson(file('ideas', ROOT_ID));
  assert.deepStrictEqual(root.supportingConnections.map((c: any) => c.reflection), [undefined, 'turned out minor']);
  assert.equal(root.supportingRepos[0].reflection, 'it carried the parser');
  assert.equal((await readJson(file('ideas', CHILD_ID))).status.comment,
    'done in fixture\n\nverified by the fixture test\n\nOutcome: shipped Effectiveness: small steps worked Lesson: test first');
  assert.equal((await readJson(file('archived-ideas', ARCHIVED_ID))).status.comment,
    'Outcome: dropped Lesson: scope was wrong Pattern: like the old planner');
  const meta = await readJson(path.join(bowman, 'meta.json'));
  assert.deepStrictEqual(meta.statuses.filter((s: any) => s.promptsReflection).map((s: any) => s.key), ['implemented', 'cancelled']);
  assert.equal(await needsTwoNotesMigration(bowman), false);

  const migratedRaw = await fs.readFile(file('ideas', CHILD_ID), 'utf8');
  await migrateTwoNotes(bowman);
  assert.equal(await fs.readFile(file('ideas', CHILD_ID), 'utf8'), migratedRaw, 'a second run is a no-op');

  // An old checkout or a merge brings a legacy note back.
  root.reflection = 'from an old branch';
  await fs.writeFile(file('ideas', ROOT_ID), JSON.stringify(root));
  assert.equal(await needsTwoNotesMigration(bowman), true);
  await migrateTwoNotes(bowman);
  assert.equal((await readJson(file('ideas', ROOT_ID))).status.comment, 'open in fixture\n\nfrom an old branch');
});
