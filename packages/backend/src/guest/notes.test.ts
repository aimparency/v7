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

test('a guest offers a space of theirs to an idea; the owner accepts it and the space supports the idea', async () => {
  const kitchen = (await ben.graphs.create({ name: 'Ben cooks' })).slug;
  const offered = await ben.project.getMeta({ graph: kitchen });
  const space = { host: `https://hub.example.org/spaces/${kitchen}/`, repoId: offered.repoId!, name: 'Ben cooks' };

  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId, kind: 'offer', text: 'Without a space' }), /names the space it offers/);
  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'x', space }), /only an offer does/);
  const own = await ana.project.getMeta({ graph: projectPath });
  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId, kind: 'offer', text: '', space: { ...space, repoId: own.repoId! } }), /offered to itself/);

  const offer = await ben.notes.add({ graph: projectPath, ideaId, kind: 'offer', text: 'Cooking every Friday feeds the kitchen.', space });
  assert.equal(offer.space?.host, `https://hub.example.org/spaces/${kitchen}`, 'the address is kept in its plain form');
  await assert.rejects(ben.notes.add({ graph: projectPath, ideaId, kind: 'offer', text: 'Again', space }), /offered to this idea already/);
  assert.deepEqual((await ana.notes.recent()).map(note => note.space?.name), ['Ben cooks'], 'the owner sees the offer');

  await assert.rejects(ben.notes.acceptOffer({ graph: projectPath, id: offer.id }), /open read-only/);
  await assert.rejects(ana.notes.acceptOffer({ graph: projectPath, id: (await ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Just a note' })).id }), /offers no space/);
  await ana.notes.acceptOffer({ graph: projectPath, id: offer.id, weight: 2 });

  const idea = await ana.idea.get({ graph: projectPath, ideaId });
  assert.deepEqual(idea.supportingRepos?.map(({ repoId, weight, hypothesis }) => ({ repoId, weight, hypothesis })),
    [{ repoId: offered.repoId, weight: 2, hypothesis: 'Cooking every Friday feeds the kitchen.' }]);
  const links = (await ana.project.getMeta({ graph: projectPath })).linkedRepos;
  assert.deepEqual(links?.map(({ repoId, name, host }) => ({ repoId, name, host })), [{ repoId: offered.repoId, name: 'Ben cooks', host: `https://hub.example.org/spaces/${kitchen}` }]);
  assert.deepEqual((await texts(ana)).filter(text => text.includes('offer')), [], 'the accepted offer is done');
});

test('an offer is seen in the graph by its proposer and by those who write the space; accepting keeps where it was dropped', async () => {
  const offerOf = async (caller: Caller, name: string) => {
    const slug = (await caller.graphs.create({ name })).slug;
    return { host: `https://hub.example.org/spaces/${slug}`, repoId: (await caller.project.getMeta({ graph: slug })).repoId!, name };
  };
  const bens = await ben.notes.add({ graph: projectPath, ideaId, kind: 'offer', text: '', space: await offerOf(ben, 'Ben cooks'), relativePosition: [1.5, -0.5] });
  await cleo.notes.add({ graph: projectPath, ideaId, kind: 'offer', text: '', space: await offerOf(cleo, 'Cleo bakes') });
  await ben.notes.add({ graph: projectPath, ideaId, kind: 'note', text: 'Not an offer' });

  const seen = async (caller: Caller) => (await caller.notes.offers({ graph: projectPath })).map(offer => `${offer.space?.name}${offer.mine ? ' (mine)' : ''}`);
  assert.deepEqual(await seen(ben), ['Ben cooks (mine)']);
  assert.deepEqual(await seen(cleo), ['Cleo bakes (mine)']);
  assert.deepEqual(await seen(ana), ['Ben cooks', 'Cleo bakes'], 'the owner sees every offer');
  assert.deepEqual(await seen(appRouter.createCaller({ session: {} })), []);

  await ana.notes.acceptOffer({ graph: projectPath, id: bens.id });
  const idea = await ana.idea.get({ graph: projectPath, ideaId });
  assert.deepEqual(idea.supportingRepos?.[0]?.relativePosition, [1.5, -0.5]);
  assert.deepEqual(await seen(ben), [], 'accepted: no longer an offer, a link');
});
