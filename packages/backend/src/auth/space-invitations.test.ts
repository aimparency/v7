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
import { listSpaces } from '../spaces/registry';
import * as accounts from './accounts';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
type Caller = ReturnType<typeof appRouter.createCaller>;
let felix: Caller;
let slug = '';
const visitor = () => appRouter.createCaller({ session: {}, address: '10.0.0.9' });

const loggedIn = async (name: string, rights: { serverAdmin?: boolean; canCreateSpaces?: boolean } = {}) => {
  await accounts.createAccount(name, `${name} password`, rights);
  return appRouter.createCaller({ session: { token: (await accounts.login(name, `${name} password`))! } });
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-space-invitations-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', signUp: { open: false }, guestDefaults: { read: 'selected' } });
  felix = await loggedIn('felix', { serverAdmin: true });
  slug = (await felix.spaces.create({ name: 'Game' })).slug;
});

afterEach(async () => {
  for (const space of listSpaces()) clearIndices(space.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

test('an invitation to a space makes an account that writes it, on a server without open sign-up', async () => {
  await assert.rejects(visitor().auth.signUp({ name: 'stranger', password: 'stranger password' }), /needs an invitation/);

  const { code } = await felix.spaces.invite({ space: slug, right: 'write' });
  assert.deepEqual(await visitor().auth.invitationInfo({ invitation: code }), { valid: true, space: { slug, name: 'Game' }, right: 'write' });

  const david = visitor();
  const { space } = await david.auth.signUp({ name: 'david', password: 'david password', invitation: code });
  assert.equal(space, slug);
  assert.ok(await david.project.getMeta({ space: slug }));
  await david.idea.createFloatingIdea({ space: slug, idea: { text: 'A boss fight' } });

  // For one person: used up.
  assert.equal((await visitor().auth.invitationInfo({ invitation: code })).valid, false);
  await assert.rejects(visitor().auth.signUp({ name: 'eve', password: 'eve password', invitation: code }), /not valid/);
  assert.deepEqual((await felix.spaces.invitations({ space: slug })).map(invitation => [invitation.right, invitation.redeemedBy, invitation.invitedBy]), [['write', 'david', 'felix']]);
});

test('an account that exists takes an invitation to read; only the owner invites and sees the invitations', async () => {
  const cleo = await loggedIn('cleo');
  await assert.rejects(cleo.project.getMeta({ space: slug }), /ask its owner/);
  await assert.rejects(cleo.spaces.invite({ space: slug, right: 'write' }), /owner|log in/i);

  const { code } = await felix.spaces.invite({ space: slug, right: 'read' });
  assert.deepEqual(await cleo.auth.acceptInvitation({ invitation: code }), { space: slug });
  assert.ok(await cleo.project.getMeta({ space: slug }));
  await assert.rejects(cleo.idea.createFloatingIdea({ space: slug, idea: { text: 'Mine' } }), /open read-only/);
  await assert.rejects(cleo.spaces.invitations({ space: slug }), /Only the owner/);
  await assert.rejects(visitor().auth.acceptInvitation({ invitation: code }), /Log in first/);

  // An invitation to the server only is for making an account.
  const { code: serverCode } = await felix.auth.createInvitation({ kind: 'once' });
  await assert.rejects(cleo.auth.acceptInvitation({ invitation: serverCode }), /new account/);
});

test('the owner takes an invitation back; a space owner who is no server admin invites too', async () => {
  const { code } = await felix.spaces.invite({ space: slug, right: 'write' });
  const [invitation] = await felix.spaces.invitations({ space: slug });
  await felix.spaces.removeInvitation({ space: slug, id: invitation!.id });
  assert.equal((await visitor().auth.invitationInfo({ invitation: code })).valid, false);

  const ana = await loggedIn('ana', { canCreateSpaces: true });
  const own = (await ana.spaces.create({ name: 'Ana Plans' })).slug;
  const { code: anaCode } = await ana.spaces.invite({ space: own, right: 'write' });
  // Not another space's invitations.
  await assert.rejects(felix.spaces.removeInvitation({ space: slug, id: (await ana.spaces.invitations({ space: own }))[0]!.id }), /No such invitation/);
  const { space } = await visitor().auth.signUp({ name: 'ben', password: 'ben password', invitation: anaCode });
  assert.equal(space, own);
});

test('a manager writes and chooses who else writes and reads; the owner alone chooses the managers', async () => {
  const ben = await loggedIn('ben');
  const cleo = await loggedIn('cleo');
  await assert.rejects(ben.spaces.setAccess({ space: slug, writers: ['cleo'] }), /ask its owner|owner/i);

  await felix.spaces.setAccess({ space: slug, managers: ['ben'] });
  assert.deepEqual((await ben.spaces.getAccess({ space: slug }))?.managers, ['ben']);
  await ben.idea.createFloatingIdea({ space: slug, idea: { text: 'Levels' } });

  // Who writes and reads: the manager's to choose.
  await ben.spaces.setAccess({ space: slug, writers: ['cleo'] });
  await cleo.idea.createFloatingIdea({ space: slug, idea: { text: 'Music' } });
  await ben.spaces.setAccess({ space: slug, writers: [], readers: ['cleo'] });
  await assert.rejects(cleo.idea.createFloatingIdea({ space: slug, idea: { text: 'More' } }), /open read-only/);
  assert.ok(await cleo.project.getMeta({ space: slug }));

  // The owner's part stays the owner's.
  await assert.rejects(ben.spaces.setAccess({ space: slug, managers: ['ben', 'cleo'] }), /Only the owner .* managers/);
  await assert.rejects(ben.spaces.setAccess({ space: slug, read: 'everyone' }), /Only the owner .* read/);
  await assert.rejects(ben.spaces.setSlug({ space: slug, slug: 'elsewhere' }), /owner/i);
  await assert.rejects(ben.spaces.remove({ space: slug }), /owner/i);
  await assert.rejects(ben.spaces.invite({ space: slug, right: 'manage' }), /Only the owner/);

  // Invitations: the manager's too.
  const { code } = await ben.spaces.invite({ space: slug, right: 'write' });
  assert.equal((await ben.spaces.invitations({ space: slug })).length, 1);
  await visitor().auth.signUp({ name: 'dora', password: 'dora password', invitation: code });
  assert.deepEqual((await felix.spaces.getAccess({ space: slug }))?.writers, ['dora']);

  // The owner invites someone to manage it.
  const { code: manageCode } = await felix.spaces.invite({ space: slug, right: 'manage' });
  assert.equal((await visitor().auth.invitationInfo({ invitation: manageCode })).right, 'manage');
  await visitor().auth.signUp({ name: 'emil', password: 'emil password', invitation: manageCode });
  assert.deepEqual((await felix.spaces.getAccess({ space: slug }))?.managers, ['ben', 'emil']);
});
