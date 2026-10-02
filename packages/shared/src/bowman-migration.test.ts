import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertWritableBowman,
  BOWMAN_MIGRATIONS,
  migrateBowman,
  NewerDataModelError,
  readDataModelVersion,
  type BowmanMigration
} from './bowman-migration.js';
import { diffGraphSignatures, readGraphSignature } from './bowman-migrations/graph-signature.js';
import { CURRENT_DATA_MODEL_VERSION } from './constants.js';
import { IdeaSchema, PhaseSchema } from './types.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

async function copyFixture(name: string): Promise<string> {
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), `bowman-${name}-`)), '.bowman');
  await fs.cp(path.join(FIXTURES, name), target, { recursive: true });
  return target;
}

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const exists = (p: string) => fs.access(p).then(() => true, () => false);

test('the registry ends at the current data model version, in order', () => {
  const versions = BOWMAN_MIGRATIONS.map((migration) => migration.version);
  assert.deepStrictEqual(versions, [...versions].sort((a, b) => a - b));
  assert.equal(versions[versions.length - 1], CURRENT_DATA_MODEL_VERSION);
});

for (const fixture of ['data-model-v1', 'data-model-v2']) {
  test(`${fixture} migrates to the current version with an unchanged graph`, async () => {
    const bowman = await copyFixture(fixture);
    const before = await readGraphSignature(bowman);

    const result = await migrateBowman(bowman);
    assert.equal(result.to, CURRENT_DATA_MODEL_VERSION);
    assert.ok(result.applied.some((step) => step.startsWith('3:')), 'the ideas layout migration ran');
    assert.deepStrictEqual(result.conflicts, []);

    assert.deepStrictEqual(diffGraphSignatures(before, await readGraphSignature(bowman)), []);
    assert.equal(await exists(path.join(bowman, 'aims')), false);
    assert.equal(await exists(path.join(bowman, '.migration-lock')), false, 'the lock is released');
    for (const dir of ['ideas', 'archived-ideas']) {
      for (const file of await fs.readdir(path.join(bowman, dir))) {
        IdeaSchema.parse(await readJson(path.join(bowman, dir, file)));
      }
    }
    for (const file of await fs.readdir(path.join(bowman, 'phases'))) {
      PhaseSchema.partial().parse(await readJson(path.join(bowman, 'phases', file)));
    }
    const meta = await readJson(path.join(bowman, 'meta.json'));
    assert.ok(meta.statuses.some((status: any) => status.key === 'implemented'));
    assert.equal((await readJson(path.join(bowman, 'runtime', 'loop-config.json'))).targetIdeaId, '11111111-1111-4111-8111-111111111111');

    const again = await migrateBowman(bowman);
    assert.deepStrictEqual(again.applied, [], 'a second run is a no-op');
  });
}

test('concurrent openers migrate once and agree on the result', async () => {
  const bowman = await copyFixture('data-model-v1');
  const before = await readGraphSignature(bowman);
  const results = await Promise.all(Array.from({ length: 5 }, () => migrateBowman(bowman)));
  assert.equal(results.filter((result) => result.applied.length > 0).length, 1, 'exactly one process applied migrations');
  assert.deepStrictEqual(diffGraphSignatures(before, await readGraphSignature(bowman)), []);
  assert.equal(await readDataModelVersion(bowman), CURRENT_DATA_MODEL_VERSION);
});

test('legacy files merged back after the upgrade are migrated without lowering the version', async () => {
  const bowman = await copyFixture('data-model-v2');
  await migrateBowman(bowman);
  const legacyId = '55555555-5555-4555-8555-555555555555';
  await fs.mkdir(path.join(bowman, 'aims'));
  await fs.writeFile(path.join(bowman, 'aims', `${legacyId}.json`), JSON.stringify({
    id: legacyId, text: 'From an old checkout', supportedAims: [], supportingConnections: [], committedIn: [],
    status: { state: 'done', comment: '', date: 1 }
  }));

  const result = await migrateBowman(bowman);
  assert.deepStrictEqual(result.applied, ['3: aims to ideas']);
  assert.equal((await readJson(path.join(bowman, 'ideas', `${legacyId}.json`))).status.state, 'implemented');
  assert.equal(await readDataModelVersion(bowman), CURRENT_DATA_MODEL_VERSION);
});

test('a project from a newer Aimparency is read-only and left untouched', async () => {
  const bowman = await copyFixture('data-model-v2');
  const metaPath = path.join(bowman, 'meta.json');
  const newer = { ...(await readJson(metaPath)), dataModelVersion: CURRENT_DATA_MODEL_VERSION + 1 };
  await fs.writeFile(metaPath, JSON.stringify(newer));

  const result = await migrateBowman(bowman);
  assert.equal(result.newerThanSupported, true);
  assert.deepStrictEqual(result.applied, []);
  assert.equal(await exists(path.join(bowman, 'aims')), true, 'nothing was migrated');
  await assert.rejects(assertWritableBowman(bowman), NewerDataModelError);
  await assertWritableBowman(await copyFixture('data-model-v1')); // older projects stay writable
});

test('migrations run in version order, each recorded, and a failure stops at the last good version', async () => {
  const bowman = await copyFixture('data-model-v2');
  await migrateBowman(bowman);
  const calls: string[] = [];
  const migrations: BowmanMigration[] = [
    ...BOWMAN_MIGRATIONS,
    { version: 5, name: 'breaks', run: async () => { calls.push('5'); throw new Error('boom'); } },
    { version: 4, name: 'adds a file', run: async (dir) => { calls.push('4'); await fs.writeFile(path.join(dir, 'v4.txt'), 'ok'); } }
  ];

  await assert.rejects(migrateBowman(bowman, { migrations, latest: 5 }), /boom/);
  assert.deepStrictEqual(calls, ['4', '5']);
  assert.equal(await readDataModelVersion(bowman), 4, 'version 4 was recorded before 5 failed');
  assert.equal(await exists(path.join(bowman, '.migration-lock')), false, 'the lock is released after a failure');
});

test('a stale lock from a crashed process does not block migrations forever', async () => {
  const bowman = await copyFixture('data-model-v1');
  const lock = path.join(bowman, '.migration-lock');
  await fs.mkdir(lock);
  const longAgo = new Date(Date.now() - 10 * 60_000);
  await fs.utimes(lock, longAgo, longAgo);
  const result = await migrateBowman(bowman);
  assert.equal(result.to, CURRENT_DATA_MODEL_VERSION);
});

test('the graph signature notices a lost connection or a changed status', async () => {
  const bowman = await copyFixture('data-model-v1');
  const before = await readGraphSignature(bowman);
  const rootFile = path.join(bowman, 'aims', '11111111-1111-4111-8111-111111111111.json');
  const root = await readJson(rootFile);
  await fs.writeFile(rootFile, JSON.stringify({ ...root, supportingConnections: root.supportingConnections.slice(1), status: { ...root.status, state: 'review' } }));
  assert.deepStrictEqual(diffGraphSignatures(before, await readGraphSignature(bowman)), ['connections', 'states']);
});
