// A space's owner invites someone to it: a link for one person, taken with a
// new account (where sign-up is closed too) or with the account they have.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import { listGraphs } from '../graphs/registry';
import * as accounts from './accounts';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
type Caller = ReturnType<typeof appRouter.createCaller>;
let felix: Caller;
let slug = '';
const visitor = () => appRouter.createCaller({ session: {}, address: '10.0.0.9' });

const loggedIn = async (name: string, rights: { serverAdmin?: boolean; canCreateGraphs?: boolean } = {}) => {
  await accounts.createAccount(name, `${name} password`, rights);
  return appRouter.createCaller({ session: { token: (await accounts.login(name, `${name} password`))! } });
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-space-invitations-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', signUp: { open: false }, guestDefaults: { read: 'selected' } });
  felix = await loggedIn('felix', { serverAdmin: true });
  slug = (await felix.graphs.create({ name: 'Game' })).slug;
});

afterEach(async () => {
  for (const graph of listGraphs()) clearIndices(graph.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

test('an invitation to a space makes an account that writes it, on a server without open sign-up', async () => {
  await assert.rejects(visitor().auth.signUp({ name: 'stranger', password: 'stranger password' }), /needs an invitation/);

  const { code } = await felix.graphs.invite({ graph: slug, right: 'write' });
  assert.deepEqual(await visitor().auth.invitationInfo({ invitation: code }), { valid: true, space: { slug, name: 'Game' }, right: 'write' });

  const david = visitor();
  const { space } = await david.auth.signUp({ name: 'david', password: 'david password', invitation: code });
  assert.equal(space, slug);
  assert.ok(await david.project.getMeta({ graph: slug }));
  await david.idea.createFloatingIdea({ graph: slug, idea: { text: 'A boss fight' } });

  // For one person: used up.
  assert.equal((await visitor().auth.invitationInfo({ invitation: code })).valid, false);
  await assert.rejects(visitor().auth.signUp({ name: 'eve', password: 'eve password', invitation: code }), /not valid/);
  assert.deepEqual((await felix.graphs.invitations({ graph: slug })).map(invitation => [invitation.right, invitation.redeemedBy, invitation.invitedBy]), [['write', 'david', 'felix']]);
});

test('an account that exists takes an invitation to read; only the owner invites and sees the invitations', async () => {
  const cleo = await loggedIn('cleo');
  await assert.rejects(cleo.project.getMeta({ graph: slug }), /ask its owner/);
  await assert.rejects(cleo.graphs.invite({ graph: slug, right: 'write' }), /owner|log in/i);

  const { code } = await felix.graphs.invite({ graph: slug, right: 'read' });
  assert.deepEqual(await cleo.auth.acceptInvitation({ invitation: code }), { space: slug });
  assert.ok(await cleo.project.getMeta({ graph: slug }));
  await assert.rejects(cleo.idea.createFloatingIdea({ graph: slug, idea: { text: 'Mine' } }), /open read-only/);
  await assert.rejects(cleo.graphs.invitations({ graph: slug }), /Only the owner/);
  await assert.rejects(visitor().auth.acceptInvitation({ invitation: code }), /Log in first/);

  // An invitation to the server only is for making an account.
  const { code: serverCode } = await felix.auth.createInvitation({ kind: 'once' });
  await assert.rejects(cleo.auth.acceptInvitation({ invitation: serverCode }), /new account/);
});

test('the owner takes an invitation back; a space owner who is no server admin invites too', async () => {
  const { code } = await felix.graphs.invite({ graph: slug, right: 'write' });
  const [invitation] = await felix.graphs.invitations({ graph: slug });
  await felix.graphs.removeInvitation({ graph: slug, id: invitation!.id });
  assert.equal((await visitor().auth.invitationInfo({ invitation: code })).valid, false);

  const ana = await loggedIn('ana', { canCreateGraphs: true });
  const own = (await ana.graphs.create({ name: 'Ana Plans' })).slug;
  const { code: anaCode } = await ana.graphs.invite({ graph: own, right: 'write' });
  // Not another space's invitations.
  await assert.rejects(felix.graphs.removeInvitation({ graph: slug, id: (await ana.graphs.invitations({ graph: own }))[0]!.id }), /No such invitation/);
  const { space } = await visitor().auth.signUp({ name: 'ben', password: 'ben password', invitation: anaCode });
  assert.equal(space, own);
});

test('a manager writes and chooses who else writes and reads; the owner alone chooses the managers', async () => {
  const ben = await loggedIn('ben');
  const cleo = await loggedIn('cleo');
  await assert.rejects(ben.graphs.setAccess({ graph: slug, writers: ['cleo'] }), /ask its owner|owner/i);

  await felix.graphs.setAccess({ graph: slug, managers: ['ben'] });
  assert.deepEqual((await ben.graphs.getAccess({ graph: slug }))?.managers, ['ben']);
  await ben.idea.createFloatingIdea({ graph: slug, idea: { text: 'Levels' } });

  // Who writes and reads: the manager's to choose.
  await ben.graphs.setAccess({ graph: slug, writers: ['cleo'] });
  await cleo.idea.createFloatingIdea({ graph: slug, idea: { text: 'Music' } });
  await ben.graphs.setAccess({ graph: slug, writers: [], readers: ['cleo'] });
  await assert.rejects(cleo.idea.createFloatingIdea({ graph: slug, idea: { text: 'More' } }), /open read-only/);
  assert.ok(await cleo.project.getMeta({ graph: slug }));

  // The owner's part stays the owner's.
  await assert.rejects(ben.graphs.setAccess({ graph: slug, managers: ['ben', 'cleo'] }), /Only the owner .* managers/);
  await assert.rejects(ben.graphs.setAccess({ graph: slug, read: 'everyone' }), /Only the owner .* read/);
  await assert.rejects(ben.graphs.setSlug({ graph: slug, slug: 'elsewhere' }), /owner/i);
  await assert.rejects(ben.graphs.remove({ graph: slug }), /owner/i);
  await assert.rejects(ben.graphs.invite({ graph: slug, right: 'manage' }), /Only the owner/);

  // Invitations: the manager's too.
  const { code } = await ben.graphs.invite({ graph: slug, right: 'write' });
  assert.equal((await ben.graphs.invitations({ graph: slug })).length, 1);
  await visitor().auth.signUp({ name: 'dora', password: 'dora password', invitation: code });
  assert.deepEqual((await felix.graphs.getAccess({ graph: slug }))?.writers, ['dora']);

  // The owner invites someone to manage it.
  const { code: manageCode } = await felix.graphs.invite({ graph: slug, right: 'manage' });
  assert.equal((await visitor().auth.invitationInfo({ invitation: manageCode })).right, 'manage');
  await visitor().auth.signUp({ name: 'emil', password: 'emil password', invitation: manageCode });
  assert.deepEqual((await felix.graphs.getAccess({ graph: slug }))?.managers, ['ben', 'emil']);
});
