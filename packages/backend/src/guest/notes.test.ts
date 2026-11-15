// Notes: what accounts without rights on a graph leave on its ideas.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import * as accounts from '../auth/accounts';
import { listGraphs } from '../graphs/registry';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
type Caller = ReturnType<typeof appRouter.createCaller>;
let ana: Caller;
let ben: Caller;
let cleo: Caller;
let projectPath = '';
let ideaId = '';

const loggedIn = async (name: string) => {
  await accounts.createAccount(name, `${name} password`);
  return appRouter.createCaller({ session: { token: (await accounts.login(name, `${name} password`))! } });
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-notes-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts' });
  [ana, ben, cleo] = await Promise.all(['ana', 'ben', 'cleo'].map(loggedIn)) as [Caller, Caller, Caller];
  projectPath = (await ana.graphs.create({ name: 'Hack the Hub' })).slug;
  ideaId = (await ana.idea.createFloatingIdea({ graph: projectPath, idea: { text: 'A shared kitchen' } })).id;
});

afterEach(async () => {
  for (const graph of listGraphs()) clearIndices(graph.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const texts = async (caller: Caller) => (await caller.notes.list({ graph: projectPath, ideaId })).notes.map(note => `${note.author}: ${note.kind} ${note.text}`);

test('a guest leaves notes on an idea of a graph they cannot change', async () => {
  await assert.rejects(ben.idea.update({ graph: projectPath, ideaId, idea: { text: 'Mine now' } }), /open read-only/);
  await ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: '  Could it also serve breakfast?  ' });
  await ben.notes.add({ graph: projectPath, ideaId, kind: 'interest', text: '' });
  const anonymous = appRouter.createCaller({ session: {} });
  await assert.rejects(anonymous.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Hi' }), /Log in first/);

  // Everyone reads them, as everyone reads the graph.
  assert.deepEqual(await texts(anonymous), ['ben: note Could it also serve breakfast?', 'ben: interest ']);
  assert.equal((await anonymous.notes.list({ graph: projectPath, ideaId })).mayAdd, true, 'a visitor may, once they have an account');

  // Notes are the server's, not the graph's: nothing of them is in the repository.
  const graph = listGraphs()[0]!;
  assert.ok(await fs.pathExists(path.join(root, 'guest', graph.slug, 'notes.json')));
  const idea = await fs.readFile(path.join(graph.path, '.bowman', 'ideas', `${ideaId}.json`), 'utf8');
  assert.ok(!idea.includes('breakfast'));

  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: '   ' }), /Write something first/);
  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'x'.repeat(2001) }), /at most 2000 characters/);
  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId: '11111111-1111-4111-8111-111111111111', kind: 'note', text: 'Nowhere' }));
});

test('a note is removed by its author or by those who write the graph', async () => {
  const note = await ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'First' });
  const other = await ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Second' });
  const flags = async (caller: Caller) => (await caller.notes.list({ graph: projectPath, ideaId })).notes.map(listed => listed.removable);
  assert.deepEqual(await flags(ben), [true, true]);
  assert.deepEqual(await flags(cleo), [false, false]);
  assert.deepEqual(await flags(ana), [true, true]);

  await assert.rejects(cleo.notes.remove({ graph: projectPath, id: note.id }), /Only its author or the people who write this space/);
  await ben.notes.remove({ graph: projectPath, id: note.id });
  await ana.notes.remove({ graph: projectPath, id: other.id });
  assert.deepEqual(await texts(ana), []);
  await assert.rejects(ana.notes.remove({ graph: projectPath, id: other.id }), /gone already/);
});

test('the owner decides who may leave notes: everyone, selected accounts, nobody', async () => {
  assert.equal((await ana.graphs.getAccess({ graph: projectPath }))?.notes, 'everyone');
  await assert.rejects(ben.graphs.setAccess({ graph: projectPath, notes: 'nobody' }), /open read-only for ben/);

  await ana.graphs.setAccess({ graph: projectPath, notes: 'nobody' });
  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Closed' }), /has not opened it for your notes/);
  assert.equal((await ben.notes.list({ graph: projectPath, ideaId })).mayAdd, false);
  await ana.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'The owner always may' });

  await ana.graphs.setAccess({ graph: projectPath, notes: 'selected', noteWriters: ['ben'] });
  await ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Selected' });
  await assert.rejects(cleo.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Not selected' }), /has not opened it/);
  assert.deepEqual((await ana.graphs.getAccess({ graph: projectPath }))?.noteWriters, ['ben']);

  // Back to what the server says for graphs that set nothing.
  await ana.graphs.setAccess({ graph: projectPath, notes: null });
  updateServerConfig({ guestDefaults: { notes: 'nobody' } });
  await assert.rejects(cleo.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Server default' }), /has not opened it/);
});

test('the owner sees recent notes of others on their graphs; an account writes only so many an hour', async () => {
  updateServerConfig({ limits: { notesPerAccountPerHour: 2 } });
  await ana.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'My own reminder' });
  await ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Older' });
  await ben.notes.add({ graph: projectPath, ideaId, kind: 'interest', text: 'I can cook' });
  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Third' }), /Too many notes in the last hour/);

  assert.deepEqual((await ana.notes.recent()).map(({ slug, ideaText, author, kind, text }) => ({ slug, ideaText, author, kind, text })), [
    { slug: 'hack-the-hub', ideaText: 'A shared kitchen', author: 'ben', kind: 'interest', text: 'I can cook' },
    { slug: 'hack-the-hub', ideaText: 'A shared kitchen', author: 'ben', kind: 'note', text: 'Older' }
  ]);
  assert.deepEqual(await ben.notes.recent(), [], 'ben writes no graph');
  assert.deepEqual(await appRouter.createCaller({ session: {} }).notes.recent(), []);

  await ana.graphs.remove({ graph: projectPath });
  assert.equal(await fs.pathExists(path.join(root, 'guest', 'hack-the-hub')), false, 'the notes go with the graph');
});
