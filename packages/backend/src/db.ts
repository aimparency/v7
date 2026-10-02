import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';

const dbCache = new Map<string, Database.Database>();

export function getDb(rawProjectPath: string): Database.Database {
  // Normalize path to ensure it includes .bowman
  const projectPath = rawProjectPath.endsWith('.bowman')
    ? rawProjectPath
    : path.join(rawProjectPath, '.bowman');

  if (dbCache.has(projectPath)) {
    return dbCache.get(projectPath)!;
  }

  const dbPath = path.join(projectPath, 'cache.db');
  fs.ensureDirSync(path.dirname(dbPath)); // Ensure .bowman directory exists
  const db = new Database(dbPath);
  
  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS idea_values (
      id TEXT PRIMARY KEY,
      value REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      done_cost REAL DEFAULT 0,
      priority REAL DEFAULT 0
    );
    DROP TABLE IF EXISTS aim_values;
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

  dbCache.set(projectPath, db);
  return db;
}

export function closeDb(rawProjectPath: string) {
  // Normalize path to match getDb()
  const projectPath = rawProjectPath.endsWith('.bowman')
    ? rawProjectPath
    : path.join(rawProjectPath, '.bowman');

  if (dbCache.has(projectPath)) {
    dbCache.get(projectPath)!.close();
    dbCache.delete(projectPath);
  }
}

export function saveAimValues(projectPath: string, values: Map<string, { value: number, cost: number, doneCost: number, priority: number }>) {
  const db = getDb(projectPath);
  
  const insert = db.prepare(`
    INSERT OR REPLACE INTO idea_values (id, value, cost, done_cost, priority)
    VALUES (@id, @value, @cost, @doneCost, @priority)
  `);

  const deleteMissing = db.prepare(`
    DELETE FROM idea_values WHERE id NOT IN (${Array.from(values.keys()).map(() => '?').join(',')})
  `);

  db.transaction(() => {
    // 1. Upsert new values
    // for (const [id, data] of values.entries()) {
    //   insert.run({
    //     id,
    //     value: data.value,
    //     cost: data.cost,
    //     doneCost: data.doneCost,
    //     priority: data.priority
    //   });
    // }
    
    // 2. Cleanup stale entries (optional, but good for cache consistency)
    // If list is huge, this delete query might be too big. 
    // Alternative: Delete all and re-insert? Or incremental updates?
    // Since we recalculate *all* values, strictly speaking we can just truncate and fill.
    // That's faster/safer than "NOT IN (?...)".
    
    // Let's try Delete All + Insert All for correctness since we have the full snapshot.
    // But wait, 'values' map comes from `calculateAimValues` which receives `ideas: Idea[]`.
    // If `ideas` is the full list, then `values` is the full list.
    
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

export function getAimValues(projectPath: string): Map<string, { value: number, cost: number, doneCost: number, priority: number }> {
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
