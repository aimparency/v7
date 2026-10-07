// Data model 4: a connection states a hypothesis and, once the child is
// settled, an evaluation of it. Registered in ../bowman-migration.ts; besides
// the version gate it also runs whenever a legacy connection key shows up again
// (an old checkout or a merge can bring one back after the upgrade).
//
//   supportingConnections[] / supportingRepos[]:
//     explanation → hypothesis
//     reflection  → evaluation
//   meta.json statuses: implemented/cancelled/failed get promptsEvaluation,
//     unless the project already configured it on some status.
//
// Idempotent per file: a key already present under its new name was written
// by new code and wins.

import path from 'node:path';
import { listJsonFiles, readOrNull, rewriteJson } from './json-files.js';

const IDEA_DIRS = ['ideas', 'archived-ideas'];
const CONNECTION_LISTS = ['supportingConnections', 'supportingRepos'];
const RENAMED_KEYS: Array<[legacy: string, current: string]> = [
  ['explanation', 'hypothesis'],
  ['reflection', 'evaluation']
];
export const EVALUATION_PROMPTING_STATES = ['implemented', 'cancelled', 'failed'];

function migrateConnection(connection: unknown): unknown {
  if (!connection || typeof connection !== 'object') return connection;
  const migrated: Record<string, unknown> = { ...connection };
  for (const [legacy, current] of RENAMED_KEYS) {
    if (!(legacy in migrated)) continue;
    if (!(current in migrated)) migrated[current] = migrated[legacy];
    delete migrated[legacy];
  }
  return migrated;
}

export function migrateConnectionKeys(record: unknown): unknown {
  if (!record || typeof record !== 'object') return record;
  const migrated: Record<string, unknown> = { ...record };
  for (const list of CONNECTION_LISTS) {
    const connections = migrated[list];
    if (Array.isArray(connections)) migrated[list] = connections.map(migrateConnection);
  }
  return migrated;
}

export function addEvaluationPrompts(meta: unknown): unknown {
  const statuses = (meta as { statuses?: unknown })?.statuses;
  if (!Array.isArray(statuses) || statuses.some((status) => status?.promptsEvaluation !== undefined)) return meta;
  return {
    ...(meta as object),
    statuses: statuses.map((status) =>
      EVALUATION_PROMPTING_STATES.includes(status?.key) ? { ...status, promptsEvaluation: true } : status
    )
  };
}

function hasLegacyConnectionKeys(record: any): boolean {
  return CONNECTION_LISTS.some((list) =>
    Array.isArray(record?.[list]) &&
    record[list].some((connection: any) => RENAMED_KEYS.some(([legacy]) => connection && legacy in connection))
  );
}

async function ideaFiles(bowmanPath: string): Promise<string[]> {
  const lists = await Promise.all(IDEA_DIRS.map((dir) => listJsonFiles(path.join(bowmanPath, dir))));
  return lists.flat();
}

export async function needsConnectionHypothesisMigration(bowmanPath: string): Promise<boolean> {
  for (const file of await ideaFiles(bowmanPath)) {
    const raw = await readOrNull(file);
    try {
      if (raw !== null && hasLegacyConnectionKeys(JSON.parse(raw))) return true;
    } catch {
      // unparseable files are the consistency tools' business
    }
  }
  return false;
}

export async function migrateConnectionHypothesis(bowmanPath: string): Promise<void> {
  for (const file of await ideaFiles(bowmanPath)) {
    await rewriteJson(file, migrateConnectionKeys);
  }
  await rewriteJson(path.join(bowmanPath, 'meta.json'), addEvaluationPrompts);
}
