// Data model 5: an idea keeps one note, its status comment; a connection keeps
// its hypothesis and the reflection that tests it. Registered in
// ../bowman-migration.ts; besides the version gate it also runs whenever a
// legacy key shows up again (an old checkout or a merge).
//
//   idea.reflection, idea.reflections[] → appended to status.comment
//   supportingConnections[] / supportingRepos[]: evaluation → reflection
//   meta.json statuses: promptsEvaluation → promptsReflection
//
// Idempotent per file: a key already present under its new name was written
// by new code and wins.

import path from 'node:path';
import { listJsonFiles, readOrNull, rewriteJson } from './json-files.js';

const IDEA_DIRS = ['ideas', 'archived-ideas'];
const CONNECTION_LISTS = ['supportingConnections', 'supportingRepos'];
const REFLECTION_PARTS = ['outcome', 'effectiveness', 'lesson', 'pattern'];

function renameKey(record: Record<string, any>, legacy: string, current: string): Record<string, any> {
  if (!(legacy in record)) return record;
  const { [legacy]: value, ...rest } = record;
  return current in rest ? rest : { ...rest, [current]: value };
}

// A structured reflection becomes one line; its context restates the idea and
// its date is in git.
function reflectionLine(entry: any): string {
  return REFLECTION_PARTS
    .filter((part) => typeof entry?.[part] === 'string' && entry[part].trim())
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}: ${entry[part].trim()}`)
    .join(' ');
}

export function migrateIdeaNotes(record: unknown): unknown {
  if (!record || typeof record !== 'object') return record;
  const { reflection, reflections, ...idea } = record as Record<string, any>;
  const notes = [
    typeof reflection === 'string' ? reflection.trim() : '',
    ...(Array.isArray(reflections) ? reflections.map(reflectionLine) : [])
  ].filter(Boolean);
  if (notes.length > 0) {
    const status = idea.status && typeof idea.status === 'object' ? idea.status : {};
    const comment = typeof status.comment === 'string' ? status.comment.trim() : '';
    idea.status = { ...status, comment: [comment, ...notes].filter(Boolean).join('\n\n') };
  }
  for (const list of CONNECTION_LISTS) {
    if (Array.isArray(idea[list])) {
      idea[list] = idea[list].map((connection: unknown) =>
        connection && typeof connection === 'object' ? renameKey(connection as Record<string, any>, 'evaluation', 'reflection') : connection
      );
    }
  }
  return idea;
}

export function migrateReflectionPrompts(meta: unknown): unknown {
  const statuses = (meta as { statuses?: unknown })?.statuses;
  if (!Array.isArray(statuses)) return meta;
  return {
    ...(meta as object),
    statuses: statuses.map((status) =>
      status && typeof status === 'object' ? renameKey(status, 'promptsEvaluation', 'promptsReflection') : status
    )
  };
}

function hasLegacyNotes(record: any): boolean {
  return 'reflection' in (record ?? {}) || 'reflections' in (record ?? {}) || CONNECTION_LISTS.some((list) =>
    Array.isArray(record?.[list]) && record[list].some((connection: any) => connection && 'evaluation' in connection)
  );
}

async function ideaFiles(bowmanPath: string): Promise<string[]> {
  const lists = await Promise.all(IDEA_DIRS.map((dir) => listJsonFiles(path.join(bowmanPath, dir))));
  return lists.flat();
}

export async function needsTwoNotesMigration(bowmanPath: string): Promise<boolean> {
  const files = [path.join(bowmanPath, 'meta.json'), ...(await ideaFiles(bowmanPath))];
  for (const file of files) {
    const raw = await readOrNull(file);
    try {
      if (raw === null) continue;
      const record = JSON.parse(raw);
      if (file.endsWith('meta.json')
        ? record?.statuses?.some?.((status: any) => status && 'promptsEvaluation' in status)
        : hasLegacyNotes(record)) return true;
    } catch {
      // unparseable files are the consistency tools' business
    }
  }
  return false;
}

export async function migrateTwoNotes(bowmanPath: string): Promise<void> {
  for (const file of await ideaFiles(bowmanPath)) {
    await rewriteJson(file, migrateIdeaNotes);
  }
  await rewriteJson(path.join(bowmanPath, 'meta.json'), migrateReflectionPrompts);
}
