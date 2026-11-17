// Deleting a space, in two steps. Deleted, it leaves every lookup and stops
// what the server runs on it; its owner may restore it for DELETED_DAYS.
// Then (or at once, when its account is discarded) it is removed for good:
// its files as its origin allows (registry.ts removeFiles), its offers to
// other spaces, and the slug from tokens limited to it.

import path from 'node:path';
import { closeDb } from '../db.js';
import { invalidateVectorCache } from '../embeddings.js';
import { stopLoopWorkersOf } from '../loop-runtime.js';
import { clearIndices } from '../search.js';
import { readJsonOrNull } from '../storage/json.js';
import { cancelRecalculation } from '../value-recalculation.js';
import { forgetGraphsInTokens } from '../auth/accounts.js';
import { listNotes, removeNotesWhere } from '../guest/notes.js';
import { deleteGraph, graphBowmanPath, listDeletedGraphs, listGraphs, purgeDate, removeGraph, slugsOf, type Graph } from './registry.js';

/** Stops what this backend runs on the graph and lets go of what it holds open. */
async function release(graph: Graph) {
  const bowmanPath = graphBowmanPath(graph);
  await stopLoopWorkersOf(bowmanPath);
  cancelRecalculation(bowmanPath);
  closeDb(bowmanPath);
  invalidateVectorCache(bowmanPath);
  clearIndices(bowmanPath);
}

export async function deleteSpace(graph: Graph, now = Date.now()) {
  await deleteGraph(graph.slug, now);
  await release(graph);
}

/** Removes the graph for good, now. */
export async function removeSpace(graph: Graph) {
  const repoId = ((await readJsonOrNull(path.join(graphBowmanPath(graph), 'meta.json'))) as { repoId?: unknown } | null)?.repoId;
  await release(graph);
  await removeGraph(graph.slug);
  await forgetGraphsInTokens(slugsOf(graph));
  if (typeof repoId === 'string') {
    for (const other of listGraphs()) {
      if ((await listNotes(other)).some(note => note.space?.repoId === repoId)) {
        await removeNotesWhere(other, note => note.space?.repoId === repoId);
      }
    }
  }
}

/** Removes for good the graphs deleted more than DELETED_DAYS ago; which. */
export async function purgeDeletedGraphs(now = Date.now()): Promise<Graph[]> {
  const expired = listDeletedGraphs().filter(graph => purgeDate(graph).getTime() <= now);
  for (const graph of expired) await removeSpace(graph);
  return expired;
}
