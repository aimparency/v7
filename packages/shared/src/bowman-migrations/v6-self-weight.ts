// Data model 6: an idea's loopWeight is called selfWeight, the share of the
// value reaching it that it realizes through its own work. Registered in
// ../bowman-migration.ts; besides the version gate it also runs whenever a
// loopWeight shows up again (an old checkout or a merge).
//
// Idempotent per file: a selfWeight already present was written by new code
// and wins.

import path from 'node:path';
import { listJsonFiles, readOrNull, rewriteJson } from './json-files.js';

const IDEA_DIRS = ['ideas', 'archived-ideas'];

export function migrateSelfWeight(record: unknown): unknown {
  if (!record || typeof record !== 'object' || !('loopWeight' in record)) return record;
  const { loopWeight, ...idea } = record as Record<string, any>;
  return 'selfWeight' in idea ? idea : { ...idea, selfWeight: loopWeight };
}

async function ideaFiles(bowmanPath: string): Promise<string[]> {
  const lists = await Promise.all(IDEA_DIRS.map((dir) => listJsonFiles(path.join(bowmanPath, dir))));
  return lists.flat();
}

export async function needsSelfWeightMigration(bowmanPath: string): Promise<boolean> {
  for (const file of await ideaFiles(bowmanPath)) {
    const raw = await readOrNull(file);
    try {
      if (raw !== null && 'loopWeight' in (JSON.parse(raw) ?? {})) return true;
    } catch {
      // unparseable files are the consistency tools' business
    }
  }
  return false;
}

export async function migrateSelfWeightFiles(bowmanPath: string): Promise<void> {
  for (const file of await ideaFiles(bowmanPath)) {
    await rewriteJson(file, migrateSelfWeight);
  }
}
