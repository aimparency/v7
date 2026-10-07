import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addEvaluationPrompts,
  migrateConnectionHypothesis,
  migrateConnectionKeys,
  needsConnectionHypothesisMigration
} from './v4-connection-hypothesis.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'data-model-v3');
const ROOT_ID = '11111111-1111-4111-8111-111111111111';

async function copyFixture(): Promise<string> {
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'bowman-v4-')), '.bowman');
  await fs.cp(FIXTURE, target, { recursive: true });
  return target;
}

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

test('connection keys are renamed on idea and repo edges; a key already under its new name wins', () => {
  const migrated = migrateConnectionKeys({
    id: 'x',
    reflection: 'idea-level reflection stays',
    supportingConnections: [
      { ideaId: 'a', explanation: 'old', reflection: 'went fine' },
      { ideaId: 'b', explanation: 'stale', hypothesis: 'written by new code' }
    ],
    supportingRepos: [{ repoId: 'r', explanation: 'repo reason' }]
  }) as any;

  assert.deepStrictEqual(migrated.supportingConnections, [
    { ideaId: 'a', hypothesis: 'old', evaluation: 'went fine' },
    { ideaId: 'b', hypothesis: 'written by new code' }
  ]);
  assert.deepStrictEqual(migrated.supportingRepos, [{ repoId: 'r', hypothesis: 'repo reason' }]);
  assert.equal(migrated.reflection, 'idea-level reflection stays');
});

test('settling statuses prompt evaluation unless the project already configured it', () => {
  const defaulted = addEvaluationPrompts({
    statuses: [{ key: 'open' }, { key: 'implemented' }, { key: 'cancelled' }, { key: 'failed' }]
  }) as any;
  assert.deepStrictEqual(defaulted.statuses.map((s: any) => s.promptsEvaluation), [undefined, true, true, true]);

  const configured = { statuses: [{ key: 'implemented', promptsEvaluation: false }, { key: 'cancelled' }] };
  assert.deepStrictEqual(addEvaluationPrompts(configured), configured);
});

test('the v3 fixture migrates, a second run changes nothing, and legacy keys brought back are pending again', async () => {
  const bowman = await copyFixture();
  const rootFile = path.join(bowman, 'ideas', `${ROOT_ID}.json`);
  assert.equal(await needsConnectionHypothesisMigration(bowman), true);

  await migrateConnectionHypothesis(bowman);
  const root = await readJson(rootFile);
  assert.deepStrictEqual(
    root.supportingConnections.map(({ hypothesis, evaluation }: any) => ({ hypothesis, evaluation })),
    [{ hypothesis: 'main path', evaluation: undefined }, { hypothesis: 'side path', evaluation: 'turned out minor' }]
  );
  const meta = await readJson(path.join(bowman, 'meta.json'));
  assert.deepStrictEqual(
    meta.statuses.filter((s: any) => s.promptsEvaluation).map((s: any) => s.key),
    ['implemented', 'cancelled']
  );
  assert.equal(await needsConnectionHypothesisMigration(bowman), false);

  const migratedRaw = await fs.readFile(rootFile, 'utf8');
  await migrateConnectionHypothesis(bowman);
  assert.equal(await fs.readFile(rootFile, 'utf8'), migratedRaw, 'a second run is a no-op');

  // An old checkout or a merge brings a legacy key back.
  root.supportingConnections[0].explanation = 'from an old branch';
  delete root.supportingConnections[0].hypothesis;
  await fs.writeFile(rootFile, JSON.stringify(root));
  assert.equal(await needsConnectionHypothesisMigration(bowman), true);
  await migrateConnectionHypothesis(bowman);
  assert.equal((await readJson(rootFile)).supportingConnections[0].hypothesis, 'from an old branch');
});
