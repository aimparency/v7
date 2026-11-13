import path from 'node:path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, delayedProcedure } from '../trpc.js';
import { mayCreateGraphs, viewerFor } from '../auth/access.js';
import { accountNames, findAccount } from '../auth/accounts.js';
import { resolveGraphAddress } from '../graphs/address.js';
import { createGraph, graphBowmanPath, GraphError, listGraphs, removeGraph, setGraphAccess, type Graph } from '../graphs/registry.js';
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
  if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: 'This directory is not on the list of this server\'s graphs.' });
  return graph;
}

function accountId(name: string): string {
  const account = findAccount(name);
  if (!account) throw new TRPCError({ code: 'BAD_REQUEST', message: `No account named "${name}".` });
  return account.id;
}

const ownerName = (graph: Graph) => graph.owner ? accountNames([graph.owner])[0] ?? null : null;

// The graphs of this server: who may read is everyone, so the list is open.
export const graphsRouter = t.router({
  list: delayedProcedure.query(async () => Promise.all(listGraphs().map(async (graph) => {
    // The name as it is on disk: no migration, no repair, just a label for the list.
    const meta = await readJsonOrNull(path.join(graphBowmanPath(graph), 'meta.json')) as { name?: string; color?: string } | null;
    return { slug: graph.slug, kind: graph.kind, name: meta?.name ?? graph.slug, color: meta?.color ?? null, owner: ownerName(graph) };
  }))),

  create: delayedProcedure
    .input(z.object({ name: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const viewer = ctx.viewer ?? viewerFor(ctx.token);
      if (!mayCreateGraphs(viewer)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Creating graphs on this server is for accounts the server admin selected.' });
      }
      const graph = await run(() => createGraph(input.name, viewer.id));
      return { slug: graph.slug };
    }),

  // Whose graph this is; null for a directory that is not on the list.
  getAccess: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(({ input }) => {
      const { graph } = resolveGraphAddress(input.projectPath);
      return graph && { slug: graph.slug, kind: graph.kind, owner: ownerName(graph), writers: accountNames(graph.writers) };
    }),

  setAccess: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      owner: z.string().optional(),
      writers: z.array(z.string()).max(500).optional()
    }))
    .mutation(async ({ input }) => {
      const graph = listed(input.projectPath);
      await run(() => setGraphAccess(graph.slug, {
        ...(input.owner !== undefined ? { owner: accountId(input.owner) } : {}),
        ...(input.writers !== undefined ? { writers: [...new Set(input.writers.map(accountId))] } : {})
      }));
      return { success: true };
    }),

  remove: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .mutation(async ({ input }) => {
      const graph = listed(input.projectPath);
      await run(() => removeGraph(graph.slug));
      clearIndices(graphBowmanPath(graph));
      return { success: true };
    })
});
