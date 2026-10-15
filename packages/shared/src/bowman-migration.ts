// Node-only (exported as `shared/bowman-migration`, never part of the browser
// bundle): versioned migrations of a .bowman directory.
//
// meta.json's dataModelVersion records the storage format. Opening a project
// runs every migration above that version, in order, under a lock shared by
// all processes touching the project (backend, loop worker, agent tools), and
// records each step. Because .bowman lives in git, legacy data can come back
// after an upgrade (an old checkout, a merge), so a migration may also declare
// a `pending` check that re-runs it whatever the recorded version says; every
// migration must therefore be idempotent.
//
// Code that finds a version newer than it knows reads but never writes
// (assertWritableBowman), so an outdated clone cannot write old-format files
// into an upgraded project. The same guard refuses writes to projects opened
// read-only.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CURRENT_DATA_MODEL_VERSION } from './constants.js';
import { migrateIdeasLayout, needsIdeasLayoutMigration } from './bowman-migrations/v3-ideas-layout.js';
import { migrateConnectionHypothesis, needsConnectionHypothesisMigration } from './bowman-migrations/v4-connection-hypothesis.js';

export {
  IMPLEMENTED_STATE,
  migrateIdeaRecord,
  migrateMetaRecord,
  renameAimIdentifier,
  renameAimKeys
} from './bowman-migrations/v3-ideas-layout.js';

export interface BowmanMigration {
  /** The dataModelVersion this migration produces. */
  version: number;
  name: string;
  /** Detects data still needing this migration regardless of the recorded version. */
  pending?: (bowmanPath: string) => Promise<boolean>;
  run: (bowmanPath: string) => Promise<{ conflicts?: string[] } | void>;
}

export const BOWMAN_MIGRATIONS: BowmanMigration[] = [
  {
    version: 2,
    name: 'ordered phase tree',
    // Phase order moved from from/to dates to meta.rootPhaseIds and
    // phase.childPhaseIds. The backend still derives that order lazily when it
    // reads legacy phases, so nothing is rewritten here.
    run: async () => {}
  },
  {
    version: 3,
    name: 'aims to ideas',
    pending: needsIdeasLayoutMigration,
    run: migrateIdeasLayout
  },
  {
    version: 4,
    name: 'connection hypothesis and evaluation',
    pending: needsConnectionHypothesisMigration,
    run: migrateConnectionHypothesis
  }
];

export interface BowmanMigrationResult {
  /** Version before migrating; null when the project has no meta.json yet. */
  from: number | null;
  to: number | null;
  applied: string[];
  conflicts: string[];
  /** The project was written by a newer Aimparency; it was left untouched. */
  newerThanSupported: boolean;
}

export class NewerDataModelError extends Error {
  constructor(readonly found: number, readonly supported: number) {
    super(`This .bowman uses data model ${found}, but this Aimparency only understands up to ${supported}. Update Aimparency before changing this project.`);
    this.name = 'NewerDataModelError';
  }
}

const LOCK_DIR = '.migration-lock';
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 60_000;

/** The recorded data model version; null without meta.json, 1 for metas from before versioning. */
export async function readDataModelVersion(bowmanPath: string): Promise<number | null> {
  const meta = await readMeta(bowmanPath);
  if (meta === null) return null;
  return typeof meta.dataModelVersion === 'number' ? meta.dataModelVersion : 1;
}

// A project opened read-only (e.g. a cloned Git repository someone shared)
// carries this machine-local marker; runtime/ is gitignored.
export const READ_ONLY_MARKER = path.join('runtime', 'read-only');

export class ReadOnlyProjectError extends Error {
  constructor() {
    super('This project is open read-only. Its ideas, phases and settings cannot be changed here.');
    this.name = 'ReadOnlyProjectError';
  }
}

/** Why the graph of this project must not be changed, or null when it may. */
export async function bowmanWriteBlocker(bowmanPath: string, supported = CURRENT_DATA_MODEL_VERSION): Promise<Error | null> {
  if (await fs.access(path.join(bowmanPath, READ_ONLY_MARKER)).then(() => true, () => false)) return new ReadOnlyProjectError();
  const version = await readDataModelVersion(bowmanPath);
  if (version !== null && version > supported) return new NewerDataModelError(version, supported);
  return null;
}

/** The one guard every graph write passes. Aimparency's own caches and migrations are not graph writes. */
export async function assertWritableBowman(bowmanPath: string, supported = CURRENT_DATA_MODEL_VERSION): Promise<void> {
  const blocker = await bowmanWriteBlocker(bowmanPath, supported);
  if (blocker) throw blocker;
}

async function pendingMigrations(bowmanPath: string, version: number | null, migrations: BowmanMigration[]) {
  const pending: BowmanMigration[] = [];
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    const behind = version !== null && migration.version > version;
    if (behind || (migration.pending && (await migration.pending(bowmanPath)))) pending.push(migration);
  }
  return pending;
}

/** Brings a .bowman up to `latest`; cheap when it already is. */
export async function migrateBowman(
  bowmanPath: string,
  { migrations = BOWMAN_MIGRATIONS, latest = CURRENT_DATA_MODEL_VERSION } = {}
): Promise<BowmanMigrationResult> {
  const from = await readDataModelVersion(bowmanPath);
  const result: BowmanMigrationResult = { from, to: from, applied: [], conflicts: [], newerThanSupported: false };
  if (from !== null && from > latest) {
    result.newerThanSupported = true;
    return result;
  }
  const relevant = migrations.filter((migration) => migration.version <= latest);
  if ((await pendingMigrations(bowmanPath, from, relevant)).length === 0) return result;

  await withLock(bowmanPath, async () => {
    // Another process may have finished while we waited for the lock.
    const version = await readDataModelVersion(bowmanPath);
    for (const migration of await pendingMigrations(bowmanPath, version, relevant)) {
      const outcome = await migration.run(bowmanPath);
      result.conflicts.push(...(outcome?.conflicts ?? []));
      result.applied.push(`${migration.version}: ${migration.name}`);
      await recordVersion(bowmanPath, migration.version);
    }
    result.to = await readDataModelVersion(bowmanPath);
  });
  return result;
}

// Only ever raises the version: a re-run of an old migration (legacy files
// merged back in) must not roll the recorded version back.
async function recordVersion(bowmanPath: string, version: number) {
  const meta = await readMeta(bowmanPath);
  if (meta === null) return; // meta.json is created with the current version by its first reader
  const recorded = typeof meta.dataModelVersion === 'number' ? meta.dataModelVersion : 1;
  if (recorded >= version) return;
  await writeAtomic(path.join(bowmanPath, 'meta.json'), `${JSON.stringify({ ...meta, dataModelVersion: version }, null, 2)}\n`);
}

async function withLock(bowmanPath: string, work: () => Promise<void>) {
  const lock = path.join(bowmanPath, LOCK_DIR);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lock, { recursive: true, force: true }); // left behind by a crashed process
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the migration lock ${lock}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    await work();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

async function readMeta(bowmanPath: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(bowmanPath, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, content: string) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.migrate-${process.pid}-${Math.random().toString(16).slice(2)}`);
  await fs.writeFile(temp, content);
  await fs.rename(temp, file);
}
