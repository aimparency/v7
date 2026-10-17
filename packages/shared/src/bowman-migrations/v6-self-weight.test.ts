import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateSelfWeight, migrateSelfWeightFiles, needsSelfWeightMigration } from './v6-self-weight.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'data-model-v5');
const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const ARCHIVED_ID = '44444444-4444-4444-8444-444444444444';

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

test('loopWeight becomes selfWeight; a selfWeight written by new code wins', () => {
  assert.deepStrictEqual(migrateSelfWeight({ id: 'x', loopWeight: 2 }), { id: 'x', selfWeight: 2 });
  assert.deepStrictEqual(migrateSelfWeight({ id: 'x', loopWeight: 2, selfWeight: 0 }), { id: 'x', selfWeight: 0 });
  assert.deepStrictEqual(migrateSelfWeight({ id: 'x', selfWeight: 1 }), { id: 'x', selfWeight: 1 });
});

test('the v5 fixture migrates, a second run changes nothing, and a loopWeight brought back is pending again', async () => {
  const bowman = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'bowman-v6-')), '.bowman');
  await fs.cp(FIXTURE, bowman, { recursive: true });
  const file = (dir: string, id: string) => path.join(bowman, dir, `${id}.json`);
  assert.equal(await needsSelfWeightMigration(bowman), true);

  await migrateSelfWeightFiles(bowman);
  const child = await readJson(file('ideas', CHILD_ID));
  assert.equal(child.selfWeight, 2);
  assert.equal('loopWeight' in child, false);
  assert.equal((await readJson(file('archived-ideas', ARCHIVED_ID))).selfWeight, 0);
  assert.equal(await needsSelfWeightMigration(bowman), false);

  const migratedRaw = await fs.readFile(file('ideas', CHILD_ID), 'utf8');
  await migrateSelfWeightFiles(bowman);
  assert.equal(await fs.readFile(file('ideas', CHILD_ID), 'utf8'), migratedRaw, 'a second run is a no-op');

  // An old checkout or a merge brings a loopWeight back.
  const root = await readJson(file('ideas', ROOT_ID));
  delete root.selfWeight;
  root.loopWeight = 3;
  await fs.writeFile(file('ideas', ROOT_ID), JSON.stringify(root));
  assert.equal(await needsSelfWeightMigration(bowman), true);
  await migrateSelfWeightFiles(bowman);
  assert.equal((await readJson(file('ideas', ROOT_ID))).selfWeight, 3);
});
