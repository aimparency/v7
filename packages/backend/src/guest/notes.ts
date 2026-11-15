// The guest layer of a graph: what accounts without rights there leave on its
// ideas. Notes are kept in the server directory (guest/<slug>/notes.json),
// never in the graph's repository: the graph stays its owner's, and a note is
// to a graph what an issue is to a repository. Its owner or writers read them
// and turn what they want into ideas.

import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { serverConfig, serverDir } from 'shared/server-config';
import type { Graph } from '../graphs/registry.js';
import { readJsonOrNull, withFileLock, writeJsonAtomic } from '../storage/json.js';

export const NOTE_KINDS = ['note', 'interest'] as const; // interest: "I'd like to work on this"
export type Note = {
  id: string;
  ideaId: string;
  kind: typeof NOTE_KINDS[number];
  text: string;
  /** Account id. */
  author: string;
  createdAt: string;
};

export const MAX_NOTE_LENGTH = 2000;
const MAX_NOTES_PER_IDEA = 200;
const MAX_NOTES_PER_GRAPH = 5000;

export class NoteError extends Error {}

const notesFile = (graph: Graph) => path.join(serverDir(), 'guest', graph.slug, 'notes.json');

export async function listNotes(graph: Graph): Promise<Note[]> {
  return ((await readJsonOrNull(notesFile(graph))) as { notes?: Note[] } | null)?.notes ?? [];
}

async function change<T>(graph: Graph, update: (notes: Note[]) => { notes: Note[]; result: T }): Promise<T> {
  const file = notesFile(graph);
  return withFileLock(file, async () => {
    const { notes, result } = update(await listNotes(graph));
    await fs.ensureDir(path.dirname(file));
    await writeJsonAtomic(file, { notes });
    return result;
  });
}

/** Whether this account may leave notes on the graph: its owner and writers always, guests by the graph's setting. */
export function mayAddNotes(graph: Graph, accountId: string, hasWriteAccess: boolean): boolean {
  if (hasWriteAccess) return true;
  const setting = graph.notes ?? serverConfig().guestDefaults.notes;
  return setting === 'everyone' || (setting === 'selected' && (graph.noteWriters ?? []).includes(accountId));
}

export async function addNote(graph: Graph, note: Pick<Note, 'ideaId' | 'kind' | 'text' | 'author'>): Promise<Note> {
  const text = note.text.trim();
  if (text.length > MAX_NOTE_LENGTH) throw new NoteError(`A note has at most ${MAX_NOTE_LENGTH} characters.`);
  if (!text && note.kind === 'note') throw new NoteError('Write something first.');
  return change(graph, (notes) => {
    if (notes.length >= MAX_NOTES_PER_GRAPH) throw new NoteError('This space holds as many notes as it can.');
    if (notes.filter(existing => existing.ideaId === note.ideaId).length >= MAX_NOTES_PER_IDEA) throw new NoteError('This idea holds as many notes as it can.');
    const added: Note = { id: crypto.randomUUID(), ideaId: note.ideaId, kind: note.kind, text, author: note.author, createdAt: new Date().toISOString() };
    return { notes: [...notes, added], result: added };
  });
}

/** Removes the note when `allowed` says this note may go (its author's, or the graph's owner and writers). */
export async function removeNote(graph: Graph, id: string, allowed: (note: Note) => boolean): Promise<void> {
  await change(graph, (notes) => {
    const note = notes.find(candidate => candidate.id === id);
    if (!note) throw new NoteError('This note is gone already.');
    if (!allowed(note)) throw new NoteError('Only its author or the people who write this space remove a note.');
    return { notes: notes.filter(candidate => candidate.id !== id), result: undefined };
  });
}
