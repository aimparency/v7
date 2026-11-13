// How a request names its graph. Every procedure takes `projectPath`; its value
// is a graph address: the slug of a graph of this server, or, only on a server
// without login, a directory on this machine. On a server with accounts a path
// is never accepted: where graphs live is the operator's business, and nobody
// reaches a directory that is not on the list.

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hasAccounts } from 'shared/server-config';
import { isGraphSlug } from 'shared';
import { findGraph, findGraphByPath, graphBowmanPath, type Graph } from './registry.js';

export type ResolvedGraph = {
  /** What handlers work with: the graph's .bowman, or the path as it was given. */
  path: string;
  /** The graph's entry in the server's list; null for a directory that is not listed. */
  graph: Graph | null;
};

export function resolveGraphAddress(address: string): ResolvedGraph {
  if (isGraphSlug(address)) {
    const graph = findGraph(address);
    if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: `No graph "${address}" on this server.` });
    return { path: graphBowmanPath(graph), graph };
  }
  if (hasAccounts()) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Graphs on this server are addressed by their name, not by a path.' });
  }
  return { path: address, graph: findGraphByPath(address) };
}

/** The `projectPath` of a procedure's input: handlers receive the directory. */
export const graphAddress = z.string().transform(address => resolveGraphAddress(address).path);
