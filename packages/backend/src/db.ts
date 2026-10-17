import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';
import { CACHE_DATABASE_FILE_NAME, CACHE_DIR_NAME } from 'shared';
import { normalizeProjectPath } from './project-path.js';

// One SQLite cache per project in .bowman/cache/: derived data only (idea
// values, embeddings, semantic neighbours), regenerable and gitignored.
const dbCache = new Map<string, Database.Database>();
const CACHE_SCHEMA_VERSION = 1;

export function cacheDatabasePath(rawProjectPath: string): string {
  return path.join(normalizeProjectPath(rawProjectPath), CACHE_DIR_NAME, CACHE_DATABASE_FILE_NAME);
}

export function getDb(rawProjectPath: string): Database.Database {
  const projectPath = normalizeProjectPath(rawProjectPath);

  if (dbCache.has(projectPath)) {
    return dbCache.get(projectPath)!;
  }

  const dbPath = cacheDatabasePath(projectPath);
  fs.ensureDirSync(path.dirname(dbPath));
  moveLegacyDatabase(projectPath, dbPath);
  const db = new Database(dbPath);
  // Readers in other processes (agent tools) never block the backend's writes.
  db.pragma('journal_mode = WAL');
  // Derived tables are rebuilt, not migrated: an older schema drops them.
  if ((db.pragma('user_version', { simple: true }) as number) < CACHE_SCHEMA_VERSION) {
    db.exec('DROP TABLE IF EXISTS semantic_neighbours');
    db.pragma(`user_version = ${CACHE_SCHEMA_VERSION}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS idea_values (
      id TEXT PRIMARY KEY,
      value REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      done_cost REAL DEFAULT 0,
      priority REAL DEFAULT 0
    );
    DROP TABLE IF EXISTS aim_values;
    -- Float32 embeddings, one row per idea: a save writes one row, not the whole store.
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      vector BLOB NOT NULL
    );
    -- Per idea its nearest ideas, as JSON [[id, distance], ...] (sorted).
    CREATE TABLE IF NOT EXISTS semantic_neighbours (
      source TEXT PRIMARY KEY,
      neighbours TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  
  // Migration: Add priority column if missing
  try {
      db.prepare('SELECT priority FROM idea_values LIMIT 1').get();
  } catch (e) {
      try {
        db.exec('ALTER TABLE idea_values ADD COLUMN priority REAL DEFAULT 0');
      } catch (e2) {
        // Ignore if already exists (race condition) or other error
      }
  }

  importLegacyVectors(projectPath, db);
  fs.removeSync(path.join(projectPath, 'semantic-graph.json'));

  dbCache.set(projectPath, db);
  return db;
}

export function getCacheMeta(db: Database.Database, key: string): string | undefined {
  return (db.prepare('SELECT value FROM cache_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

export function setCacheMeta(db: Database.Database, key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)').run(key, value);
}

export const encodeVector = (vector: ArrayLike<number>): Buffer => {
  const floats = Float32Array.from(vector);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
};

// Copies: a Buffer's offset need not be Float32-aligned.
export const decodeVector = (blob: Buffer): Float32Array =>
  new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));

// Before the cache folder, cache.db sat directly in .bowman.
function moveLegacyDatabase(projectPath: string, dbPath: string) {
  const legacyPath = path.join(projectPath, CACHE_DATABASE_FILE_NAME);
  if (!fs.existsSync(legacyPath) || fs.existsSync(dbPath)) return;
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(legacyPath + suffix)) fs.moveSync(legacyPath + suffix, dbPath + suffix);
  }
}

// Before the vectors table, embeddings lived in .bowman/vectors.json, rewritten
// in full on every save. Imported once (regenerating them costs model time).
function importLegacyVectors(projectPath: string, db: Database.Database) {
  const legacyPath = path.join(projectPath, 'vectors.json');
  if (!fs.existsSync(legacyPath)) return;
  let legacy: Record<string, unknown> = {};
  try {
    legacy = fs.readJsonSync(legacyPath);
  } catch (error: any) {
    console.warn(`Unreadable legacy vectors.json, embeddings will be regenerated: ${error.message}`);
  }
  const insert = db.prepare('INSERT OR IGNORE INTO vectors (id, vector) VALUES (?, ?)');
  db.transaction(() => {
    for (const [id, vector] of Object.entries(legacy)) {
      if (Array.isArray(vector) && vector.length > 0 && vector.every(item => typeof item === 'number' && Number.isFinite(item))) {
        insert.run(id, encodeVector(vector));
      }
    }
    bumpVectorsVersion(db);
  })();
  fs.removeSync(legacyPath);
  fs.removeSync(`${legacyPath}.tmp`);
}

// Every change to the vectors table bumps this, so derived data (semantic
// neighbours) can tell whether it still matches, across processes too.
export function vectorsVersion(db: Database.Database): number {
  return Number(getCacheMeta(db, 'vectors_version') ?? 0);
}

export function bumpVectorsVersion(db: Database.Database): number {
  const version = vectorsVersion(db) + 1;
  setCacheMeta(db, 'vectors_version', String(version));
  return version;
}

export function closeDb(rawProjectPath: string) {
  const projectPath = normalizeProjectPath(rawProjectPath);

  if (dbCache.has(projectPath)) {
    dbCache.get(projectPath)!.close();
    dbCache.delete(projectPath);
  }
}

export function saveIdeaValues(projectPath: string, values: Map<string, { value: number, cost: number, doneCost: number, priority: number }>) {
  const db = getDb(projectPath);
  
  const insert = db.prepare(`
    INSERT OR REPLACE INTO idea_values (id, value, cost, done_cost, priority)
    VALUES (@id, @value, @cost, @doneCost, @priority)
  `);

  // values is the full snapshot of a recalculation: replace the table.
  db.transaction(() => {
    db.prepare('DELETE FROM idea_values').run();
    
    for (const [id, data] of values.entries()) {
      insert.run({
        id,
        value: data.value,
        cost: data.cost,
        doneCost: data.doneCost,
        priority: data.priority
      });
    }
  })();
}

export function getIdeaValues(projectPath: string): Map<string, { value: number, cost: number, doneCost: number, priority: number }> {
  const db = getDb(projectPath);
  const rows = db.prepare('SELECT id, value, cost, done_cost as doneCost, priority FROM idea_values').all() as any[];
  
  const map = new Map();
  for (const row of rows) {
    map.set(row.id, {
      value: row.value,
      cost: row.cost,
      doneCost: row.doneCost,
      priority: row.priority || 0
    });
  }
  return map;
}
