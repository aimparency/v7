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
import { forgetSpacesInTokens } from '../auth/accounts.js';
import { listNotes, removeNotesWhere } from '../guest/notes.js';
import { deleteSpaceEntry, spaceBowmanPath, listDeletedSpaces, listSpaces, purgeDate, removeSpaceEntry, slugsOf, type Space } from './registry.js';

/** Stops what this backend runs on the space and lets go of what it holds open. */
async function release(space: Space) {
  const bowmanPath = spaceBowmanPath(space);
  await stopLoopWorkersOf(bowmanPath);
  cancelRecalculation(bowmanPath);
  closeDb(bowmanPath);
  invalidateVectorCache(bowmanPath);
  clearIndices(bowmanPath);
}

export async function deleteSpace(space: Space, now = Date.now()) {
  await deleteSpaceEntry(space.slug, now);
  await release(space);
}

/** Removes the space for good, now. */
export async function removeSpace(space: Space) {
  const repoId = ((await readJsonOrNull(path.join(spaceBowmanPath(space), 'meta.json'))) as { repoId?: unknown } | null)?.repoId;
  await release(space);
  await removeSpaceEntry(space.slug);
  await forgetSpacesInTokens(slugsOf(space));
  if (typeof repoId === 'string') {
    for (const other of listSpaces()) {
      if ((await listNotes(other)).some(note => note.offeredSpace?.repoId === repoId)) {
        await removeNotesWhere(other, note => note.offeredSpace?.repoId === repoId);
      }
    }
  }
}

/** Removes for good the spaces deleted more than DELETED_DAYS ago; which. */
export async function purgeDeletedSpaces(now = Date.now()): Promise<Space[]> {
  const expired = listDeletedSpaces().filter(space => purgeDate(space).getTime() <= now);
  for (const space of expired) await removeSpace(space);
  return expired;
}
