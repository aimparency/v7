import path from 'node:path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { serverConfig } from 'shared/server-config';
import { t, delayedProcedure } from '../trpc.js';
import { mayCreateGraphs, rightOn, viewerFor, type Viewer } from '../auth/access.js';
import { accountNames, findAccount } from '../auth/accounts.js';
import { resolveGraphAddress } from '../graphs/address.js';
import { addCheckout, createGraph, graphBowmanPath, GraphError, listGraphs, removeGraph, setGraphAccess, setGraphSlug, type Graph } from '../graphs/registry.js';
import { addRemote, selectRemoteKey } from '../graphs/remote-graph.js';
import { privateKeyFile } from '../graphs/ssh-keys.js';
import { clearIndices } from '../search.js';
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

const ownerName = (graph: Graph) => graph.owner ? accountNames([graph.owner])[0] ?? null : null;

// The graphs of this server: who may read is everyone, so the list is open.
export const graphsRouter = t.router({
  list: delayedProcedure.query(async ({ ctx }) => Promise.all(listGraphs().map(async (graph) => {
    // The name as it is on disk: no migration, no repair, just a label for the list.
    const meta = await readJsonOrNull(path.join(graphBowmanPath(graph), 'meta.json')) as { name?: string; color?: string } | null;
    return {
      slug: graph.slug, kind: graph.kind, name: meta?.name ?? graph.slug, color: meta?.color ?? null, owner: ownerName(graph),
      // What the asker is on this graph: the UI offers their own graphs for an MCP client.
      right: rightOn(graph, ctx.viewer ?? viewerFor(ctx.session?.token))
    };
  }))),

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
  // Any account may add one. It is read-only until its owner selects a key.
  addRemote: delayedProcedure
    .input(z.object({ url: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      assertBelowGraphLimit(viewer);
      const graph = await run(() => addRemote(input.url, viewer.id));
      return { slug: graph.slug };
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
      noteWriters: z.array(z.string()).max(500).optional()
    }))
    .mutation(async ({ input }) => {
      const graph = listed(input.graph);
      await run(() => setGraphAccess(graph.slug, {
        ...(input.owner !== undefined ? { owner: accountId(input.owner) } : {}),
        ...(input.writers !== undefined ? { writers: [...new Set(input.writers.map(accountId))] } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? undefined } : {}),
        ...(input.noteWriters !== undefined ? { noteWriters: [...new Set(input.noteWriters.map(accountId))] } : {})
      }));
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
      await run(() => removeGraph(graph.slug));
      clearIndices(graphBowmanPath(graph));
      return { success: true };
    })
});
