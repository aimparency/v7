import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  migrateBowmanLayout,
  migrateIdeaRecord,
  migrateMetaRecord,
  needsBowmanMigration,
  renameAimIdentifier,
  renameAimKeys
} from './bowman-migration.js';

const PARENT = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const ARCHIVED = '33333333-3333-4333-8333-333333333333';

function legacyAim(id: string, state: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    text: `aim ${id.slice(0, 4)} — text values stay untouched`,
    description: 'Supports the parent aim.',
    tags: ['aim'],
    supportingConnections: [{ aimId: CHILD, relativePosition: [1, 2], weight: 1 }],
    supportedAims: [PARENT],
    committedIn: [],
    status: { state, comment: 'aim was done', date: 1 },
    ...extra
  };
}

async function makeLegacyBowman() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bowman-migration-'));
  const bowman = path.join(root, '.bowman');
  const write = async (rel: string, data: unknown) => {
    await fs.mkdir(path.dirname(path.join(bowman, rel)), { recursive: true });
    await fs.writeFile(path.join(bowman, rel), JSON.stringify(data, null, 2));
  };
  await write(`aims/${PARENT}.json`, legacyAim(PARENT, 'done'));
  await write(`aims/${CHILD}.json`, legacyAim(CHILD, 'open'));
  await write(`archived-aims/${ARCHIVED}.json`, legacyAim(ARCHIVED, 'cancelled', { archived: true }));
  await write('phases/p.json', { id: 'p', parent: null, commitments: [PARENT], name: 'Phase' });
  await write('meta.json', {
    name: 'Legacy',
    color: '#007acc',
    statuses: [{ key: 'open', color: '#fff' }, { key: 'done', color: '#0f0' }]
  });
  await write('runtime/loop-config.json', { targetAimId: PARENT, status: 'done', '/home/me/aims': { aimsWorked: 2 } });
  await write('memory/sessions/s.json', { aimsWorked: 3 });
  return bowman;
}

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

test('renameAimIdentifier renames aim segments only', () => {
  assert.equal(renameAimIdentifier('supportedAims'), 'supportedIdeas');
  assert.equal(renameAimIdentifier('aimId'), 'ideaId');
  assert.equal(renameAimIdentifier('targetAimId'), 'targetIdeaId');
  assert.equal(renameAimIdentifier('aim_values'), 'idea_values');
  assert.equal(renameAimIdentifier('AIM_STATES'), 'IDEA_STATES');
  assert.equal(renameAimIdentifier('aimparency'), 'aimparency');
  assert.equal(renameAimIdentifier('claim'), 'claim');
  assert.equal(renameAimIdentifier('aimed'), 'aimed');
  assert.equal(renameAimIdentifier('/home/me/aims'), '/home/me/aims', 'non-identifier keys stay');
});

test('migrateIdeaRecord renames keys and done→implemented but keeps values', () => {
  const migrated = migrateIdeaRecord(legacyAim(PARENT, 'done')) as any;
  assert.deepStrictEqual(migrated.supportedIdeas, [PARENT]);
  assert.equal(migrated.supportedAims, undefined);
  assert.equal(migrated.supportingConnections[0].ideaId, CHILD);
  assert.equal(migrated.status.state, 'implemented');
  assert.equal(migrated.status.comment, 'aim was done');
  assert.equal(migrated.text, legacyAim(PARENT, 'done').text);
  assert.deepStrictEqual(migrated.tags, ['aim']);
  assert.equal((migrateIdeaRecord(legacyAim(PARENT, 'review')) as any).status.state, 'review');
});

test('renameAimKeys prefers an already-migrated key over its legacy twin', () => {
  assert.deepStrictEqual(renameAimKeys({ supportedAims: ['old'], supportedIdeas: ['new'] }), { supportedIdeas: ['new'] });
});

test('migrateMetaRecord renames the done status and never duplicates implemented', () => {
  const meta = migrateMetaRecord({ statuses: [{ key: 'done', color: '#0f0' }, { key: 'open', color: '#fff' }] }) as any;
  assert.deepStrictEqual(meta.statuses.map((s: any) => s.key), ['implemented', 'open']);
  assert.equal(meta.statuses[0].color, '#0f0', 'custom colors survive');
  const both = migrateMetaRecord({ statuses: [{ key: 'done', color: '#0f0' }, { key: 'implemented', color: '#1f1' }] }) as any;
  assert.deepStrictEqual(both.statuses, [{ key: 'implemented', color: '#1f1' }]);
});

test('migrateBowmanLayout migrates a legacy .bowman end to end', async () => {
  const bowman = await makeLegacyBowman();
  assert.equal(await needsBowmanMigration(bowman), true);

  const report = await migrateBowmanLayout(bowman);
  assert.equal(report.migratedIdeas, 3);
  assert.deepStrictEqual(report.conflicts, []);

  const legacyDirs = await Promise.all(['aims', 'archived-aims'].map((d) => fs.access(path.join(bowman, d)).then(() => d, () => null)));
  assert.deepStrictEqual(legacyDirs.filter(Boolean), [], 'legacy directories are removed');
  assert.equal(await needsBowmanMigration(bowman), false);

  const parent = await readJson(path.join(bowman, 'ideas', `${PARENT}.json`));
  assert.equal(parent.status.state, 'implemented');
  assert.deepStrictEqual(parent.supportedIdeas, [PARENT]);
  const archived = await readJson(path.join(bowman, 'archived-ideas', `${ARCHIVED}.json`));
  assert.equal(archived.archived, true);

  const meta = await readJson(path.join(bowman, 'meta.json'));
  assert.deepStrictEqual(meta.statuses.map((s: any) => s.key), ['open', 'implemented']);
  const phase = await readJson(path.join(bowman, 'phases', 'p.json'));
  assert.deepStrictEqual(phase.commitments, [PARENT]);

  const loopConfig = await readJson(path.join(bowman, 'runtime', 'loop-config.json'));
  assert.equal(loopConfig.targetIdeaId, PARENT);
  assert.equal(loopConfig.status, 'done', 'non-idea "done" values stay');
  assert.deepStrictEqual(loopConfig['/home/me/aims'], { ideasWorked: 2 }, 'path keys stay, nested identifier keys migrate');
  assert.deepStrictEqual(await readJson(path.join(bowman, 'memory', 'sessions', 's.json')), { ideasWorked: 3 });
});

test('migrateBowmanLayout is idempotent and safe to run concurrently', async () => {
  const bowman = await makeLegacyBowman();
  const reports = await Promise.all([migrateBowmanLayout(bowman), migrateBowmanLayout(bowman), migrateBowmanLayout(bowman)]);
  assert.ok(reports.every((r) => r.conflicts.length === 0));
  const ideas = (await fs.readdir(path.join(bowman, 'ideas'))).sort();
  assert.deepStrictEqual(ideas, [`${PARENT}.json`, `${CHILD}.json`]);
  const again = await migrateBowmanLayout(bowman);
  assert.deepStrictEqual(again, { migratedIdeas: 0, conflicts: [], rewrittenFiles: 0 });
  assert.equal((await readJson(path.join(bowman, 'ideas', `${PARENT}.json`))).status.state, 'implemented');
});

test('a legacy file reappearing after migration (old checkout) is merged without losing either version', async () => {
  const bowman = await makeLegacyBowman();
  await migrateBowmanLayout(bowman);
  const currentFile = path.join(bowman, 'ideas', `${CHILD}.json`);
  await fs.utimes(currentFile, new Date(1000), new Date(1000));

  await fs.mkdir(path.join(bowman, 'aims'));
  const legacyEdit = legacyAim(CHILD, 'review', { text: 'edited on an old checkout' });
  await fs.writeFile(path.join(bowman, 'aims', `${CHILD}.json`), JSON.stringify(legacyEdit));
  const newIdea = legacyAim(ARCHIVED, 'open', { id: '44444444-4444-4444-8444-444444444444' });
  await fs.writeFile(path.join(bowman, 'aims', '44444444-4444-4444-8444-444444444444.json'), JSON.stringify(newIdea));

  const report = await migrateBowmanLayout(bowman);
  assert.deepStrictEqual(report.conflicts, [`${CHILD}.json`]);
  assert.equal((await readJson(currentFile)).text, 'edited on an old checkout', 'the newer legacy edit wins');
  const backup = await readJson(path.join(bowman, 'migration-conflicts', `${CHILD}.ideas.json`));
  assert.equal(backup.status.state, 'open', 'the overwritten version is kept');
  assert.ok(await fs.access(path.join(bowman, 'ideas', '44444444-4444-4444-8444-444444444444.json')).then(() => true));
});

test('migrateBowmanLayout leaves an already-current .bowman untouched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bowman-current-'));
  await fs.mkdir(path.join(root, 'ideas'), { recursive: true });
  const meta = { name: 'x', statuses: [{ key: 'done', color: '#0f0' }] };
  await fs.writeFile(path.join(root, 'meta.json'), JSON.stringify(meta));
  assert.deepStrictEqual(await migrateBowmanLayout(root), { migratedIdeas: 0, conflicts: [], rewrittenFiles: 0 });
  assert.deepStrictEqual(await readJson(path.join(root, 'meta.json')), meta, 'a current layout keeps user-chosen statuses');
});

test('unexpected entries in a legacy directory never keep it alive', async () => {
  const bowman = await makeLegacyBowman();
  await fs.mkdir(path.join(bowman, 'ideas'), { recursive: true });
  await fs.writeFile(path.join(bowman, 'ideas', 'notes.txt'), 'new');
  await fs.writeFile(path.join(bowman, 'aims', 'notes.txt'), 'old');
  await fs.writeFile(path.join(bowman, 'aims', 'broken.json'), '{ not json');
  await migrateBowmanLayout(bowman);
  assert.equal(await needsBowmanMigration(bowman), false);
  assert.equal(await fs.readFile(path.join(bowman, 'ideas', 'notes.txt'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(bowman, 'migration-conflicts', 'notes.txt.legacy'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(bowman, 'ideas', 'broken.json'), 'utf8'), '{ not json');
});
