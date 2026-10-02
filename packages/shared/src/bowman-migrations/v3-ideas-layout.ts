// Data model 3: the aim→idea rename. Registered in ../bowman-migration.ts;
// besides the version gate it also runs whenever aims/ shows up again (an old
// checkout or a merge can bring legacy files back after the upgrade).
//
// Legacy layout                       → current layout
//   aims/<id>.json                     → ideas/<id>.json
//   archived-aims/<id>.json            → archived-ideas/<id>.json
//   keys: supportedAims, aimId, …      → supportedIdeas, ideaId, …
//   status.state "done"                → "implemented"
//   meta.json statuses key "done"      → "implemented"
//   runtime/ and memory/ JSON keys     → renamed like the idea keys
//
// Every step is idempotent and per-file, so concurrent processes (backend,
// loop worker, agent tools) and interrupted runs converge. A legacy file whose
// id already exists in the new layout with different content is not dropped:
// the newer one wins and the other is kept under migration-conflicts/.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const LEGACY_DIRS: Array<[legacy: string, current: string]> = [
  ['aims', 'ideas'],
  ['archived-aims', 'archived-ideas']
];
const KEY_RENAMED_DIRS = ['runtime', 'memory'];
const CONFLICT_DIR = 'migration-conflicts';

const LEGACY_DONE_STATE = 'done';
export const IMPLEMENTED_STATE = 'implemented';

// One "aim" word segment: lowercase when not preceded by a lowercase letter,
// Capitalized at any camelCase boundary, ALLCAPS when not touching letters.
// Never followed by a lowercase letter, so "aimparency", "claim", "aimed" stay.
const AIM_SEGMENT = /(?<![a-z])(aim)(s?)(?![a-z])|(Aim)(s?)(?![a-z])|(?<![A-Za-z])AIM(S|s)?(?![A-Za-z])/g;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function renameAimIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) return name; // e.g. path-keyed maps in runtime state
  return name.replace(AIM_SEGMENT, (_m, lower, lowerS, cap, capS, capsS) => {
    if (lower) return `idea${lowerS}`;
    if (cap) return `Idea${capS}`;
    return `IDEA${capsS ?? ''}`;
  });
}

export function renameAimKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameAimKeys);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const renamed = renameAimIdentifier(key);
    // A key that already exists under its new name was written by new code; keep it.
    if (renamed !== key && Object.prototype.hasOwnProperty.call(value, renamed)) continue;
    result[renamed] = renameAimKeys(child);
  }
  return result;
}

export function migrateIdeaRecord(record: unknown): unknown {
  const migrated = renameAimKeys(record) as Record<string, any>;
  if (migrated?.status?.state === LEGACY_DONE_STATE) {
    migrated.status = { ...migrated.status, state: IMPLEMENTED_STATE };
  }
  return migrated;
}

export function migrateMetaRecord(meta: unknown): unknown {
  const migrated = renameAimKeys(meta) as Record<string, any>;
  if (Array.isArray(migrated?.statuses)) {
    const hasImplemented = migrated.statuses.some((s: any) => s?.key === IMPLEMENTED_STATE);
    migrated.statuses = migrated.statuses
      .filter((s: any) => !(hasImplemented && s?.key === LEGACY_DONE_STATE))
      .map((s: any) => (s?.key === LEGACY_DONE_STATE ? { ...s, key: IMPLEMENTED_STATE } : s));
  }
  return migrated;
}

export interface IdeasLayoutReport {
  migratedIdeas: number;
  conflicts: string[];
  rewrittenFiles: number;
}

export function needsIdeasLayoutMigration(bowmanPath: string): Promise<boolean> {
  return Promise.all(LEGACY_DIRS.map(([legacy]) => exists(path.join(bowmanPath, legacy))))
    .then((found) => found.some(Boolean));
}

/** Migrates a legacy .bowman in place; a no-op on current layouts. */
export async function migrateIdeasLayout(bowmanPath: string): Promise<IdeasLayoutReport> {
  const report: IdeasLayoutReport = { migratedIdeas: 0, conflicts: [], rewrittenFiles: 0 };
  if (!(await needsIdeasLayoutMigration(bowmanPath))) return report;

  for (const [legacy, current] of LEGACY_DIRS) {
    await migrateIdeaDir(bowmanPath, legacy, current, report);
  }

  const metaPath = path.join(bowmanPath, 'meta.json');
  if (await rewriteJson(metaPath, migrateMetaRecord)) report.rewrittenFiles++;
  for (const dir of KEY_RENAMED_DIRS) {
    for (const file of await listJsonFiles(path.join(bowmanPath, dir))) {
      if (await rewriteJson(file, renameAimKeys)) report.rewrittenFiles++;
    }
  }
  return report;
}

async function migrateIdeaDir(bowmanPath: string, legacy: string, current: string, report: IdeasLayoutReport) {
  const legacyDir = path.join(bowmanPath, legacy);
  const currentDir = path.join(bowmanPath, current);
  let entries: string[];
  try {
    entries = await fs.readdir(legacyDir);
  } catch {
    return; // another process finished this directory
  }
  await fs.mkdir(currentDir, { recursive: true });

  for (const name of entries) {
    const legacyFile = path.join(legacyDir, name);
    const currentFile = path.join(currentDir, name);
    if (!name.endsWith('.json')) {
      await moveAside(bowmanPath, legacyFile, currentFile);
      continue;
    }
    const raw = await readOrNull(legacyFile);
    if (raw === null) continue;
    let migrated: string;
    try {
      migrated = `${JSON.stringify(migrateIdeaRecord(JSON.parse(raw)), null, 2)}\n`;
    } catch {
      // Unparseable files move unchanged; the consistency tools report them.
      await moveAside(bowmanPath, legacyFile, currentFile);
      continue;
    }

    const existing = await readOrNull(currentFile);
    if (existing !== null && !sameJson(existing, migrated)) {
      const [legacyStat, currentStat] = await Promise.all([fs.stat(legacyFile), fs.stat(currentFile)]);
      const legacyIsNewer = legacyStat.mtimeMs > currentStat.mtimeMs;
      const conflictFile = path.join(bowmanPath, CONFLICT_DIR, `${path.parse(name).name}.${legacyIsNewer ? current : legacy}.json`);
      await fs.mkdir(path.dirname(conflictFile), { recursive: true });
      await writeAtomic(conflictFile, legacyIsNewer ? existing : migrated);
      if (legacyIsNewer) await writeAtomic(currentFile, migrated);
      report.conflicts.push(name);
    } else if (existing === null) {
      await writeAtomic(currentFile, migrated);
    }
    await fs.rm(legacyFile, { force: true });
    report.migratedIdeas++;
  }
  await fs.rmdir(legacyDir).catch(() => {}); // stays if something unexpected remains
}

async function rewriteJson(file: string, transform: (value: unknown) => unknown): Promise<boolean> {
  const raw = await readOrNull(file);
  if (raw === null) return false;
  let next: string;
  try {
    next = `${JSON.stringify(transform(JSON.parse(raw)), null, 2)}\n`;
  } catch {
    return false;
  }
  if (sameJson(raw, next)) return false;
  await writeAtomic(file, next);
  return true;
}

async function listJsonFiles(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listJsonFiles(full)));
    else if (entry.name.endsWith('.json')) files.push(full);
  }
  return files;
}

function sameJson(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return a === b;
  }
}

// Moves an entry the migrator can't interpret; if the target name is taken it
// goes to migration-conflicts/ so the legacy directory can always be removed.
async function moveAside(bowmanPath: string, from: string, to: string) {
  const target = (await exists(to)) ? path.join(bowmanPath, CONFLICT_DIR, `${path.basename(from)}.legacy`) : to;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(from, target).catch(() => {});
}

async function writeAtomic(file: string, content: string) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.migrate-${process.pid}-${Math.random().toString(16).slice(2)}`);
  await fs.writeFile(temp, content);
  await fs.rename(temp, file);
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
