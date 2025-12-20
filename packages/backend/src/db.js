import Database from 'better-sqlite3';
import path from 'path';
const dbCache = new Map();
export function getDb(projectPath) {
    if (dbCache.has(projectPath)) {
        return dbCache.get(projectPath);
    }
    const dbPath = path.join(projectPath, 'cache.db');
    const db = new Database(dbPath);
    // Initialize schema
    db.exec(`
    CREATE TABLE IF NOT EXISTS aim_values (
      id TEXT PRIMARY KEY,
      value REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      done_cost REAL DEFAULT 0
    );
  `);
    dbCache.set(projectPath, db);
    return db;
}
export function closeDb(projectPath) {
    if (dbCache.has(projectPath)) {
        dbCache.get(projectPath).close();
        dbCache.delete(projectPath);
    }
}
export function saveAimValues(projectPath, values) {
    const db = getDb(projectPath);
    const insert = db.prepare(`
    INSERT OR REPLACE INTO aim_values (id, value, cost, done_cost)
    VALUES (@id, @value, @cost, @doneCost)
  `);
    const deleteMissing = db.prepare(`
    DELETE FROM aim_values WHERE id NOT IN (${Array.from(values.keys()).map(() => '?').join(',')})
  `);
    db.transaction(() => {
        // 1. Upsert new values
        for (const [id, data] of values.entries()) {
            insert.run({
                id,
                value: data.value,
                cost: data.cost,
                doneCost: data.doneCost
            });
        }
        // 2. Cleanup stale entries (optional, but good for cache consistency)
        // If list is huge, this delete query might be too big. 
        // Alternative: Delete all and re-insert? Or incremental updates?
        // Since we recalculate *all* values, strictly speaking we can just truncate and fill.
        // That's faster/safer than "NOT IN (?...)".
        // Let's try Delete All + Insert All for correctness since we have the full snapshot.
        // But wait, 'values' map comes from `calculateAimValues` which receives `aims: Aim[]`.
        // If `aims` is the full list, then `values` is the full list.
        db.prepare('DELETE FROM aim_values').run();
        for (const [id, data] of values.entries()) {
            insert.run({
                id,
                value: data.value,
                cost: data.cost,
                doneCost: data.doneCost
            });
        }
    })();
}
export function getAimValues(projectPath) {
    const db = getDb(projectPath);
    const rows = db.prepare('SELECT id, value, cost, done_cost as doneCost FROM aim_values').all();
    const map = new Map();
    for (const row of rows) {
        map.set(row.id, {
            value: row.value,
            cost: row.cost,
            doneCost: row.doneCost
        });
    }
    return map;
}
