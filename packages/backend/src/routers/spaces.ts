import path from 'node:path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { serverConfig } from 'shared/server-config';
import { t, delayedProcedure } from '../trpc.js';
import { mayCreateSpaces, mayRead, readSettingOf, rightOn, viewerFor, type Viewer } from '../auth/access.js';
import { accountNames, createInvitation, findAccount, listInvitations, removeInvitation } from '../auth/accounts.js';
import { resolveSpaceAddress } from '../spaces/address.js';
import { addCheckout, createSpace, spaceBowmanPath, SpaceError, listDeletedSpaces, listSpaces, purgeDate, restoreSpace, setSpaceAccess, setSpaceSlug, slugsOf, type Space } from '../spaces/registry.js';
import { deleteSpace, purgeDeletedSpaces } from '../spaces/deletion.js';
import { addRemote, selectRemoteKey } from '../spaces/remote-space.js';
import { privateKeyFile } from '../spaces/ssh-keys.js';
import { readJsonOrNull } from '../storage/json.js';

// Space errors are the caller's to read ("needs a name", "exists already").
async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SpaceError) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
}

function listed(address: string): Space {
  const { space } = resolveSpaceAddress(address);
  if (!space) throw new TRPCError({ code: 'NOT_FOUND', message: 'This directory is not on the list of this server\'s spaces.' });
  return space;
}

function accountId(name: string): string {
  const account = findAccount(name);
  if (!account) throw new TRPCError({ code: 'BAD_REQUEST', message: `No account named "${name}".` });
  return account.id;
}

// Keeps one account from filling the server; the server admin is not counted.
function assertBelowSpaceLimit(viewer: Viewer) {
  const owned = listSpaces().filter(space => space.owner === viewer.id).length;
  if (!viewer.serverAdmin && owned >= serverConfig().limits.spacesPerAccount) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `An account has at most ${serverConfig().limits.spacesPerAccount} spaces on this server.` });
  }
}

const readMeta = async (space: Space) =>
  await readJsonOrNull(path.join(spaceBowmanPath(space), 'meta.json')) as { name?: string; color?: string } | null;

const ownerName = (space: Space) => space.owner ? accountNames([space.owner])[0] ?? null : null;

// The spaces of this server: the list holds those the asker may read.
export const spacesRouter = t.router({
  list: delayedProcedure.query(async ({ ctx }) => {
    // Deleted spaces past their time go for good whenever the spaces are listed.
    await purgeDeletedSpaces();
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    return Promise.all(listSpaces().filter(space => mayRead(space, viewer)).map(async (space) => {
      // The name as it is on disk: no migration, no repair, just a label for the list.
      const meta = await readMeta(space);
      return {
        slug: space.slug, kind: space.kind, name: meta?.name ?? space.slug, color: meta?.color ?? null, owner: ownerName(space),
        // What the asker is on this space: the UI offers their own spaces for an MCP client.
        right: rightOn(space, viewer)
      };
    }));
  }),

  // The asker's deleted spaces, restorable until they go for good.
  listDeleted: delayedProcedure.query(async ({ ctx }) => {
    // Deleted spaces past their time go for good whenever the spaces are listed.
    await purgeDeletedSpaces();
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    return Promise.all(listDeletedSpaces().filter(space => rightOn(space, viewer) === 'owner').map(async (space) => {
      const meta = await readMeta(space);
      return { slug: space.slug, name: meta?.name ?? space.slug, color: meta?.color ?? null, deletedAt: space.deletedAt, purgeAt: purgeDate(space).toISOString() };
    }));
  }),

  // A deleted space back on the list. Not by `space`: a deleted one resolves to nothing.
  restore: delayedProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const space = listDeletedSpaces().find(candidate => candidate.slug === input.slug);
      if (!space || rightOn(space, ctx.viewer ?? viewerFor(ctx.session?.token)) !== 'owner') {
        throw new TRPCError({ code: 'NOT_FOUND', message: `No deleted space "${input.slug}" of yours on this server.` });
      }
      const restored = await run(() => restoreSpace(space.slug));
      return { slug: restored.slug };
    }),

  create: delayedProcedure
    .input(z.object({ name: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      if (!mayCreateSpaces(viewer)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Creating spaces on this server is for accounts the server admin selected.' });
      }
      assertBelowSpaceLimit(viewer);
      const space = await run(() => createSpace(input.name, viewer.id));
      return { slug: space.slug };
    }),

  // A repository that is already on this machine, by its path: the operator's
  // doing, so server admins only (like `pnpm spaces add`). It belongs to the server admins.
  addCheckout: delayedProcedure
    .input(z.object({ path: z.string().min(1).max(1000), slug: z.string().max(100).optional() }))
    .mutation(async ({ input }) => {
      const space = await run(() => addCheckout(input.path, null, input.slug || undefined));
      return { slug: space.slug };
    }),

  // A space that lives in a repository elsewhere: its .bowman is cloned here.
  // Any account may add one. Without a key it is read-only until its owner
  // selects one; with one of the caller's keys (a deploy key of the repository)
  // a private repository is cloned, and one without a .bowman gets a new space.
  addRemote: delayedProcedure
    .input(z.object({ url: z.string().min(1).max(500), key: z.string().max(50).optional() }))
    .mutation(async ({ ctx, input }) => {
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      assertBelowSpaceLimit(viewer);
      if (input.key !== undefined && (viewer.id === null || !await privateKeyFile(viewer.id, input.key))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select one of your own keys.' });
      }
      const key = input.key !== undefined ? { account: viewer.id!, id: input.key } : undefined;
      const space = await run(() => addRemote(input.url, viewer.id, { key }));
      return { slug: space.slug, started: space.started === true, pushError: space.pushError ?? null };
    }),

  // The key a remote space is pushed with: one of the caller's own, or none.
  // With a key the space is edited here, committed and pushed; without, it only follows its remote.
  setRemoteKey: delayedProcedure
    .input(z.object({ space: z.string(), key: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const space = listed(input.space);
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      if (input.key !== null && (viewer.id === null || !await privateKeyFile(viewer.id, input.key))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select one of your own keys.' });
      }
      await run(() => selectRemoteKey(space, input.key === null ? null : { account: viewer.id!, id: input.key }));
      return { success: true };
    }),

  // Whose space this is; null for a directory that is not on the list.
  getAccess: delayedProcedure
    .input(z.object({ space: z.string() }))
    .query(({ input }) => {
      const { space } = resolveSpaceAddress(input.space);
      return space && {
        slug: space.slug, kind: space.kind, owner: ownerName(space), managers: accountNames(space.managers ?? []), writers: accountNames(space.writers),
        notes: space.notes ?? serverConfig().guestDefaults.notes, noteWriters: accountNames(space.noteWriters ?? []),
        read: readSettingOf(space), readers: accountNames(space.readers ?? []),
        // The address is public; of the key only whose it is, never the key.
        remote: space.remote ? { url: space.remote.url, key: space.remote.key?.id ?? null, keyOwner: space.remote.key ? accountNames([space.remote.key.account])[0] ?? null : null } : null
      };
    }),

  setAccess: delayedProcedure
    .input(z.object({
      space: z.string(),
      owner: z.string().optional(),
      managers: z.array(z.string()).max(500).optional(),
      writers: z.array(z.string()).max(500).optional(),
      // Who may leave notes: null goes back to the server's default.
      notes: z.enum(['everyone', 'selected', 'nobody']).nullable().optional(),
      noteWriters: z.array(z.string()).max(500).optional(),
      // Who may read it besides its owner and writers: null goes back to the server's default.
      read: z.enum(['everyone', 'accounts', 'selected']).nullable().optional(),
      readers: z.array(z.string()).max(500).optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const space = listed(input.space);
      // A manager chooses who writes, reads and leaves notes; who owns and
      // manages it, and whether it is read at all or noted on, stay the owner's.
      const ownerOnly = (['owner', 'managers', 'read', 'notes'] as const).filter(field => input[field] !== undefined);
      if (ownerOnly.length > 0 && rightOn(space, ctx.viewer ?? viewerFor(ctx.session?.token)) !== 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: `Only the owner of this space changes ${ownerOnly.join(', ')}.` });
      }
      await run(() => setSpaceAccess(space.slug, {
        ...(input.owner !== undefined ? { owner: accountId(input.owner) } : {}),
        ...(input.managers !== undefined ? { managers: [...new Set(input.managers.map(accountId))] } : {}),
        ...(input.writers !== undefined ? { writers: [...new Set(input.writers.map(accountId))] } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? undefined } : {}),
        ...(input.noteWriters !== undefined ? { noteWriters: [...new Set(input.noteWriters.map(accountId))] } : {}),
        ...(input.read !== undefined ? { read: input.read ?? undefined } : {}),
        ...(input.readers !== undefined ? { readers: [...new Set(input.readers.map(accountId))] } : {})
      }));
      return { success: true };
    }),

  // Its owner or a manager invites someone to this space (to manage it: the
  // owner only): a link for one person, who takes
  // it with a new account or the one they have. The code is shown this once.
  invite: delayedProcedure
    .input(z.object({ space: z.string(), right: z.enum(['read', 'write', 'manage']), days: z.number().positive().max(365).default(14) }))
    .mutation(async ({ ctx, input }) => {
      const space = listed(input.space);
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      if (input.right === 'manage' && rightOn(space, viewer) !== 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner of this space invites someone to manage it.' });
      }
      const code = await createInvitation({
        kind: 'once', grant: { space: space.slug, right: input.right },
        expiresAt: new Date(Date.now() + input.days * 24 * 60 * 60_000).toISOString(),
        ...(viewer.id ? { invitedBy: viewer.id } : {})
      });
      return { code };
    }),

  // The invitations to this space, for its owner and managers.
  invitations: delayedProcedure
    .input(z.object({ space: z.string() }))
    .query(({ ctx, input }) => {
      const space = listed(input.space);
      const right = rightOn(space, ctx.viewer ?? viewerFor(ctx.session?.token));
      if (right !== 'owner' && right !== 'manage') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner of this space and its managers see its invitations.' });
      }
      const slugs = slugsOf(space);
      return listInvitations().filter(invitation => invitation.grant && slugs.includes(invitation.grant.space))
        .map(({ id, grant, expiresAt, redeemedBy, invitedBy, createdAt }) => ({ id, right: grant!.right, expiresAt, redeemedBy, invitedBy, createdAt }));
    }),

  removeInvitation: delayedProcedure
    .input(z.object({ space: z.string(), id: z.string().max(100) }))
    .mutation(async ({ input }) => {
      const slugs = slugsOf(listed(input.space));
      const invitation = listInvitations().find(candidate => candidate.id === input.id);
      if (!invitation?.grant || !slugs.includes(invitation.grant.space)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No such invitation to this space.' });
      }
      await removeInvitation(input.id);
      return { success: true };
    }),

  // The space's address (/spaces/<slug>). The old one keeps leading here.
  setSlug: delayedProcedure
    .input(z.object({ space: z.string(), slug: z.string().trim().max(100) }))
    .mutation(async ({ input }) => {
      const space = listed(input.space);
      const renamed = await run(() => setSpaceSlug(space.slug, input.slug));
      return { slug: renamed.slug };
    }),

  remove: delayedProcedure
    .input(z.object({ space: z.string() }))
    .mutation(async ({ input }) => {
      const space = listed(input.space);
      // Restorable for DELETED_DAYS (spaces.restore), then removed for good.
      await run(() => deleteSpace(space));
      return { success: true };
    })
});
