// Discarding an account held only by a browser key: when its person logs out
// (nobody can log into it again: the key was the only way in) or when it has
// been unused for long (server.json limits.idleAutomaticAccountDays). What it
// made goes with it: its notes and offers, its places in other spaces' lists,
// its logins, and the spaces it owns that nobody else is in (offers of those
// to other spaces go too). A space others manage or write in passes to them.

import path from 'node:path';
import { serverConfig } from 'shared/server-config';
import { readJsonOrNull } from '../storage/json.js';
import { spaceBowmanPath, listDeletedSpaces, listSpaces, setSpaceAccess, type Space } from '../spaces/registry.js';
import { removeSpace } from '../spaces/deletion.js';
import { listNotes, removeNotesWhere } from '../guest/notes.js';
import { expiredDeletedAccounts, idleAutomaticAccounts, removeAccountById } from './accounts.js';

/**
 * Who takes over a space when its owner's account is discarded: a manager,
 * else a writer, the one added first (the lists keep the order people joined).
 * Nobody: the space goes with the account.
 */
export function heirOf(space: Space, owner: string): string | null {
  return [...(space.managers ?? []), ...space.writers].find(id => id !== owner) ?? null;
}

const spaceName = async (space: Space) =>
  ((await readJsonOrNull(path.join(spaceBowmanPath(space), 'meta.json'))) as { name?: string } | null)?.name ?? space.slug;

/** What discarding the account would do: the spaces it owns that go and those that pass on (by name), its notes and offers. */
export async function accountFootprint(id: string): Promise<{ spaces: string[]; passedOn: string[]; notes: number; offers: number }> {
  const owned = listSpaces().filter(space => space.owner === id);
  const spaces = await Promise.all(owned.filter(space => !heirOf(space, id)).map(spaceName));
  const passedOn = await Promise.all(owned.filter(space => heirOf(space, id)).map(spaceName));
  const written = (await Promise.all(listSpaces().map(listNotes))).flat().filter(note => note.author === id);
  return { spaces, passedOn, notes: written.filter(note => note.kind !== 'offer').length, offers: written.filter(note => note.kind === 'offer').length };
}

export async function discardAccount(id: string): Promise<void> {
  // Spaces others are in pass to them; its deleted spaces go for good.
  for (const space of listSpaces().filter(space => space.owner === id)) {
    const heir = heirOf(space, id);
    if (!heir) continue;
    await setSpaceAccess(space.slug, {
      owner: heir,
      writers: space.writers.filter(writer => writer !== heir),
      ...(space.managers ? { managers: space.managers.filter(manager => manager !== heir) } : {})
    });
  }
  const owned = [...listSpaces(), ...listDeletedSpaces()].filter(space => space.owner === id);
  const repoIds = new Set((await Promise.all(owned.map(async space =>
    ((await readJsonOrNull(path.join(spaceBowmanPath(space), 'meta.json'))) as { repoId?: string } | null)?.repoId)))
    .filter((repoId): repoId is string => typeof repoId === 'string'));
  for (const space of owned) await removeSpace(space);
  for (const space of listSpaces()) {
    await removeNotesWhere(space, note => note.author === id || (note.offeredSpace !== undefined && repoIds.has(note.offeredSpace.repoId)));
    if (space.writers.includes(id) || space.managers?.includes(id) || space.noteWriters?.includes(id) || space.readers?.includes(id)) {
      await setSpaceAccess(space.slug, {
        writers: space.writers.filter(writer => writer !== id),
        ...(space.managers ? { managers: space.managers.filter(manager => manager !== id) } : {}),
        ...(space.noteWriters ? { noteWriters: space.noteWriters.filter(writer => writer !== id) } : {}),
        ...(space.readers ? { readers: space.readers.filter(reader => reader !== id) } : {})
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
