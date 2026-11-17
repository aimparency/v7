// Discarding an account held only by a browser key: when its person logs out
// (nobody can log into it again: the key was the only way in) or when it has
// been unused for long (server.json limits.idleAutomaticAccountDays). What it
// made goes with it: the spaces it owns, its notes and offers, its places in
// other spaces' lists, its logins. Offers of its spaces to other spaces go too.

import path from 'node:path';
import { serverConfig } from 'shared/server-config';
import { readJsonOrNull } from '../storage/json.js';
import { graphBowmanPath, listDeletedGraphs, listGraphs, setGraphAccess } from '../graphs/registry.js';
import { removeSpace } from '../graphs/deletion.js';
import { listNotes, removeNotesWhere } from '../guest/notes.js';
import { idleAutomaticAccounts, removeAccountById } from './accounts.js';

/** What discarding the account would remove: the spaces it owns (by name) and its notes and offers. */
export async function accountFootprint(id: string): Promise<{ spaces: string[]; notes: number; offers: number }> {
  const owned = listGraphs().filter(graph => graph.owner === id);
  const spaces = await Promise.all(owned.map(async graph =>
    ((await readJsonOrNull(path.join(graphBowmanPath(graph), 'meta.json'))) as { name?: string } | null)?.name ?? graph.slug));
  const written = (await Promise.all(listGraphs().map(listNotes))).flat().filter(note => note.author === id);
  return { spaces, notes: written.filter(note => note.kind !== 'offer').length, offers: written.filter(note => note.kind === 'offer').length };
}

export async function discardAccount(id: string): Promise<void> {
  // Its deleted spaces go for good as well.
  const owned = [...listGraphs(), ...listDeletedGraphs()].filter(graph => graph.owner === id);
  const repoIds = new Set((await Promise.all(owned.map(async graph =>
    ((await readJsonOrNull(path.join(graphBowmanPath(graph), 'meta.json'))) as { repoId?: string } | null)?.repoId)))
    .filter((repoId): repoId is string => typeof repoId === 'string'));
  for (const graph of owned) await removeSpace(graph);
  for (const graph of listGraphs()) {
    await removeNotesWhere(graph, note => note.author === id || (note.space !== undefined && repoIds.has(note.space.repoId)));
    if (graph.writers.includes(id) || graph.noteWriters?.includes(id)) {
      await setGraphAccess(graph.slug, {
        writers: graph.writers.filter(writer => writer !== id),
        ...(graph.noteWriters ? { noteWriters: graph.noteWriters.filter(writer => writer !== id) } : {})
      });
    }
  }
  await removeAccountById(id);
}

/** Discards the automatic accounts unused for longer than the server allows; how many. */
export async function discardIdleAccounts(now = Date.now()): Promise<number> {
  const idle = idleAutomaticAccounts(serverConfig().limits.idleAutomaticAccountDays, now);
  for (const id of idle) {
    try {
      await discardAccount(id);
    } catch (error) {
      console.error(`[accounts] Could not discard idle account ${id}`, error);
    }
  }
  return idle.length;
}
