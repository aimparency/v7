import path from 'node:path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { serverConfig } from 'shared/server-config';
import { t, delayedProcedure } from '../trpc.js';
import { mayCreateGraphs, mayRead, readSettingOf, rightOn, viewerFor, type Viewer } from '../auth/access.js';
import { accountNames, createInvitation, findAccount, listInvitations, removeInvitation } from '../auth/accounts.js';
import { resolveGraphAddress } from '../graphs/address.js';
import { addCheckout, createGraph, graphBowmanPath, GraphError, listDeletedGraphs, listGraphs, purgeDate, restoreGraph, setGraphAccess, setGraphSlug, slugsOf, type Graph } from '../graphs/registry.js';
import { deleteSpace, purgeDeletedGraphs } from '../graphs/deletion.js';
import { addRemote, selectRemoteKey } from '../graphs/remote-graph.js';
import { privateKeyFile } from '../graphs/ssh-keys.js';
import { readJsonOrNull } from '../storage/json.js';

// Graph errors are the caller's to read ("needs a name", "exists already").
async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof GraphError) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
}

function listed(address: string): Graph {
  const { graph } = resolveGraphAddress(address);
  if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: 'This directory is not on the list of this server\'s spaces.' });
  return graph;
}

function accountId(name: string): string {
  const account = findAccount(name);
  if (!account) throw new TRPCError({ code: 'BAD_REQUEST', message: `No account named "${name}".` });
  return account.id;
}

// Keeps one account from filling the server; the server admin is not counted.
function assertBelowGraphLimit(viewer: Viewer) {
  const owned = listGraphs().filter(graph => graph.owner === viewer.id).length;
  if (!viewer.serverAdmin && owned >= serverConfig().limits.graphsPerAccount) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `An account has at most ${serverConfig().limits.graphsPerAccount} spaces on this server.` });
  }
}

const readMeta = async (graph: Graph) =>
  await readJsonOrNull(path.join(graphBowmanPath(graph), 'meta.json')) as { name?: string; color?: string } | null;

const ownerName = (graph: Graph) => graph.owner ? accountNames([graph.owner])[0] ?? null : null;

// The graphs of this server: the list holds those the asker may read.
export const graphsRouter = t.router({
  list: delayedProcedure.query(async ({ ctx }) => {
    // Deleted graphs past their time go for good whenever the spaces are listed.
    await purgeDeletedGraphs();
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    return Promise.all(listGraphs().filter(graph => mayRead(graph, viewer)).map(async (graph) => {
      // The name as it is on disk: no migration, no repair, just a label for the list.
      const meta = await readMeta(graph);
      return {
        slug: graph.slug, kind: graph.kind, name: meta?.name ?? graph.slug, color: meta?.color ?? null, owner: ownerName(graph),
        // What the asker is on this graph: the UI offers their own graphs for an MCP client.
        right: rightOn(graph, viewer)
      };
    }));
  }),

  // The asker's deleted spaces, restorable until they go for good.
  listDeleted: delayedProcedure.query(async ({ ctx }) => {
    // Deleted graphs past their time go for good whenever the spaces are listed.
    await purgeDeletedGraphs();
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    return Promise.all(listDeletedGraphs().filter(graph => rightOn(graph, viewer) === 'owner').map(async (graph) => {
      const meta = await readMeta(graph);
      return { slug: graph.slug, name: meta?.name ?? graph.slug, color: meta?.color ?? null, deletedAt: graph.deletedAt, purgeAt: purgeDate(graph).toISOString() };
    }));
  }),

  // A deleted space back on the list. Not by `graph`: a deleted one resolves to nothing.
  restore: delayedProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const graph = listDeletedGraphs().find(candidate => candidate.slug === input.slug);
      if (!graph || rightOn(graph, ctx.viewer ?? viewerFor(ctx.session?.token)) !== 'owner') {
        throw new TRPCError({ code: 'NOT_FOUND', message: `No deleted space "${input.slug}" of yours on this server.` });
      }
      const restored = await run(() => restoreGraph(graph.slug));
      return { slug: restored.slug };
    }),

  create: delayedProcedure
    .input(z.object({ name: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      if (!mayCreateGraphs(viewer)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Creating spaces on this server is for accounts the server admin selected.' });
      }
      assertBelowGraphLimit(viewer);
      const graph = await run(() => createGraph(input.name, viewer.id));
      return { slug: graph.slug };
    }),

  // A repository that is already on this machine, by its path: the operator's
  // doing, so server admins only (like `pnpm graphs add`). It belongs to the server admins.
  addCheckout: delayedProcedure
    .input(z.object({ path: z.string().min(1).max(1000), slug: z.string().max(100).optional() }))
    .mutation(async ({ input }) => {
      const graph = await run(() => addCheckout(input.path, null, input.slug || undefined));
      return { slug: graph.slug };
    }),

  // A graph that lives in a repository elsewhere: its .bowman is cloned here.
  // Any account may add one. Without a key it is read-only until its owner
  // selects one; with one of the caller's keys (a deploy key of the repository)
  // a private repository is cloned, and one without a .bowman gets a new space.
  addRemote: delayedProcedure
    .input(z.object({ url: z.string().min(1).max(500), key: z.string().max(50).optional() }))
    .mutation(async ({ ctx, input }) => {
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      assertBelowGraphLimit(viewer);
      if (input.key !== undefined && (viewer.id === null || !await privateKeyFile(viewer.id, input.key))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select one of your own keys.' });
      }
      const key = input.key !== undefined ? { account: viewer.id!, id: input.key } : undefined;
      const graph = await run(() => addRemote(input.url, viewer.id, { key }));
      return { slug: graph.slug, started: graph.started === true, pushError: graph.pushError ?? null };
    }),

  // The key a remote graph is pushed with: one of the caller's own, or none.
  // With a key the graph is edited here, committed and pushed; without, it only follows its remote.
  setRemoteKey: delayedProcedure
    .input(z.object({ graph: z.string(), key: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const graph = listed(input.graph);
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      if (input.key !== null && (viewer.id === null || !await privateKeyFile(viewer.id, input.key))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select one of your own keys.' });
      }
      await run(() => selectRemoteKey(graph, input.key === null ? null : { account: viewer.id!, id: input.key }));
      return { success: true };
    }),

  // Whose graph this is; null for a directory that is not on the list.
  getAccess: delayedProcedure
    .input(z.object({ graph: z.string() }))
    .query(({ input }) => {
      const { graph } = resolveGraphAddress(input.graph);
      return graph && {
        slug: graph.slug, kind: graph.kind, owner: ownerName(graph), writers: accountNames(graph.writers),
        notes: graph.notes ?? serverConfig().guestDefaults.notes, noteWriters: accountNames(graph.noteWriters ?? []),
        read: readSettingOf(graph), readers: accountNames(graph.readers ?? []),
        // The address is public; of the key only whose it is, never the key.
        remote: graph.remote ? { url: graph.remote.url, key: graph.remote.key?.id ?? null, keyOwner: graph.remote.key ? accountNames([graph.remote.key.account])[0] ?? null : null } : null
      };
    }),

  setAccess: delayedProcedure
    .input(z.object({
      graph: z.string(),
      owner: z.string().optional(),
      writers: z.array(z.string()).max(500).optional(),
      // Who may leave notes: null goes back to the server's default.
      notes: z.enum(['everyone', 'selected', 'nobody']).nullable().optional(),
      noteWriters: z.array(z.string()).max(500).optional(),
      // Who may read it besides its owner and writers: null goes back to the server's default.
      read: z.enum(['everyone', 'accounts', 'selected']).nullable().optional(),
      readers: z.array(z.string()).max(500).optional()
    }))
    .mutation(async ({ input }) => {
      const graph = listed(input.graph);
      await run(() => setGraphAccess(graph.slug, {
        ...(input.owner !== undefined ? { owner: accountId(input.owner) } : {}),
        ...(input.writers !== undefined ? { writers: [...new Set(input.writers.map(accountId))] } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? undefined } : {}),
        ...(input.noteWriters !== undefined ? { noteWriters: [...new Set(input.noteWriters.map(accountId))] } : {}),
        ...(input.read !== undefined ? { read: input.read ?? undefined } : {}),
        ...(input.readers !== undefined ? { readers: [...new Set(input.readers.map(accountId))] } : {})
      }));
      return { success: true };
    }),

  // Its owner invites someone to this space: a link for one person, who takes
  // it with a new account or the one they have. The code is shown this once.
  invite: delayedProcedure
    .input(z.object({ graph: z.string(), right: z.enum(['read', 'write']), days: z.number().positive().max(365).default(14) }))
    .mutation(async ({ ctx, input }) => {
      const graph = listed(input.graph);
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      const code = await createInvitation({
        kind: 'once', grant: { graph: graph.slug, right: input.right },
        expiresAt: new Date(Date.now() + input.days * 24 * 60 * 60_000).toISOString(),
        ...(viewer.id ? { invitedBy: viewer.id } : {})
      });
      return { code };
    }),

  // The invitations to this space, for its owner.
  invitations: delayedProcedure
    .input(z.object({ graph: z.string() }))
    .query(({ ctx, input }) => {
      const graph = listed(input.graph);
      if (rightOn(graph, ctx.viewer ?? viewerFor(ctx.session?.token)) !== 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner of this space sees its invitations.' });
      }
      const slugs = slugsOf(graph);
      return listInvitations().filter(invitation => invitation.grant && slugs.includes(invitation.grant.graph))
        .map(({ id, grant, expiresAt, redeemedBy, invitedBy, createdAt }) => ({ id, right: grant!.right, expiresAt, redeemedBy, invitedBy, createdAt }));
    }),

  removeInvitation: delayedProcedure
    .input(z.object({ graph: z.string(), id: z.string().max(100) }))
    .mutation(async ({ input }) => {
      const slugs = slugsOf(listed(input.graph));
      const invitation = listInvitations().find(candidate => candidate.id === input.id);
      if (!invitation?.grant || !slugs.includes(invitation.grant.graph)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No such invitation to this space.' });
      }
      await removeInvitation(input.id);
      return { success: true };
    }),

  // The graph's address (/spaces/<slug>). The old one keeps leading here.
  setSlug: delayedProcedure
    .input(z.object({ graph: z.string(), slug: z.string().trim().max(100) }))
    .mutation(async ({ input }) => {
      const graph = listed(input.graph);
      const renamed = await run(() => setGraphSlug(graph.slug, input.slug));
      return { slug: renamed.slug };
    }),

  remove: delayedProcedure
    .input(z.object({ graph: z.string() }))
    .mutation(async ({ input }) => {
      const graph = listed(input.graph);
      // Restorable for DELETED_DAYS (graphs.restore), then removed for good.
      await run(() => deleteSpace(graph));
      return { success: true };
    })
});
