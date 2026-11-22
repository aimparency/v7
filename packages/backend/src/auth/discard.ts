// Discarding an account held only by a browser key: when its person logs out
// (nobody can log into it again: the key was the only way in) or when it has
// been unused for long (server.json limits.idleAutomaticAccountDays). What it
// made goes with it: its notes and offers, its places in other spaces' lists,
// its logins, and the spaces it owns that nobody else is in (offers of those
// to other spaces go too). A space others manage or write in passes to them.

import path from 'node:path';
import { serverConfig } from 'shared/server-config';
import { readJsonOrNull } from '../storage/json.js';
import { graphBowmanPath, listDeletedGraphs, listGraphs, setGraphAccess, type Graph } from '../graphs/registry.js';
import { removeSpace } from '../graphs/deletion.js';
import { listNotes, removeNotesWhere } from '../guest/notes.js';
import { expiredDeletedAccounts, idleAutomaticAccounts, removeAccountById } from './accounts.js';

/**
 * Who takes over a space when its owner's account is discarded: a manager,
 * else a writer, the one added first (the lists keep the order people joined).
 * Nobody: the space goes with the account.
 */
export function heirOf(graph: Graph, owner: string): string | null {
  return [...(graph.managers ?? []), ...graph.writers].find(id => id !== owner) ?? null;
}

const spaceName = async (graph: Graph) =>
  ((await readJsonOrNull(path.join(graphBowmanPath(graph), 'meta.json'))) as { name?: string } | null)?.name ?? graph.slug;

/** What discarding the account would do: the spaces it owns that go and those that pass on (by name), its notes and offers. */
export async function accountFootprint(id: string): Promise<{ spaces: string[]; passedOn: string[]; notes: number; offers: number }> {
  const owned = listGraphs().filter(graph => graph.owner === id);
  const spaces = await Promise.all(owned.filter(graph => !heirOf(graph, id)).map(spaceName));
  const passedOn = await Promise.all(owned.filter(graph => heirOf(graph, id)).map(spaceName));
  const written = (await Promise.all(listGraphs().map(listNotes))).flat().filter(note => note.author === id);
  return { spaces, passedOn, notes: written.filter(note => note.kind !== 'offer').length, offers: written.filter(note => note.kind === 'offer').length };
}

export async function discardAccount(id: string): Promise<void> {
  // Spaces others are in pass to them; its deleted spaces go for good.
  for (const graph of listGraphs().filter(graph => graph.owner === id)) {
    const heir = heirOf(graph, id);
    if (!heir) continue;
    await setGraphAccess(graph.slug, {
      owner: heir,
      writers: graph.writers.filter(writer => writer !== heir),
      ...(graph.managers ? { managers: graph.managers.filter(manager => manager !== heir) } : {})
    });
  }
  const owned = [...listGraphs(), ...listDeletedGraphs()].filter(graph => graph.owner === id);
  const repoIds = new Set((await Promise.all(owned.map(async graph =>
    ((await readJsonOrNull(path.join(graphBowmanPath(graph), 'meta.json'))) as { repoId?: string } | null)?.repoId)))
    .filter((repoId): repoId is string => typeof repoId === 'string'));
  for (const graph of owned) await removeSpace(graph);
  for (const graph of listGraphs()) {
    await removeNotesWhere(graph, note => note.author === id || (note.space !== undefined && repoIds.has(note.space.repoId)));
    if (graph.writers.includes(id) || graph.managers?.includes(id) || graph.noteWriters?.includes(id) || graph.readers?.includes(id)) {
      await setGraphAccess(graph.slug, {
        writers: graph.writers.filter(writer => writer !== id),
        ...(graph.managers ? { managers: graph.managers.filter(manager => manager !== id) } : {}),
        ...(graph.noteWriters ? { noteWriters: graph.noteWriters.filter(writer => writer !== id) } : {}),
        ...(graph.readers ? { readers: graph.readers.filter(reader => reader !== id) } : {})
      });
    }
  }
  await removeAccountById(id);
}

/**
 * Discards the automatic accounts unused for longer than the server allows,
 * and the accounts deleted by their people longer than ACCOUNT_DELETION_DAYS ago; how many.
 */
export async function discardIdleAccounts(now = Date.now()): Promise<number> {
  const idle = [...new Set([...idleAutomaticAccounts(serverConfig().limits.idleAutomaticAccountDays, now), ...expiredDeletedAccounts(now)])];
  for (const id of idle) {
    try {
      await discardAccount(id);
    } catch (error) {
      console.error(`[accounts] Could not discard idle account ${id}`, error);
    }
  }
  return idle.length;
}
