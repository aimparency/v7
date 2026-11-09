import fs from 'fs-extra';
import path from 'path';

// Ids come from requests and from files pulled through git; one that could
// leave its directory (`../x`, `a/b`) must never become a path.
const ENTITY_ID = /^[\w-]+$/;

/** The file of an idea or phase: `<projectPath>/<dir>/<id>.json`, refusing unsafe ids. */
export function entityFile(projectPath: string, dir: string, id: string): string {
  if (!ENTITY_ID.test(id)) throw new Error(`Invalid id: ${JSON.stringify(id).slice(0, 80)}`);
  return path.join(projectPath, dir, `${id}.json`);
}

export async function readJsonOrNull(filePath: string): Promise<any | null> {
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await fs.writeJson(tempPath, data, { spaces: 2 });
  await fs.move(tempPath, filePath, { overwrite: true });
}

const fileLocks = new Map<string, Promise<unknown>>();

// Serializes read-modify-write cycles on one file within this process, so
// concurrent requests cannot overwrite each other's changes.
export async function withFileLock<T>(filePath: string, update: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(filePath) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(update);
  fileLocks.set(filePath, current);
  try {
    return await current;
  } finally {
    if (fileLocks.get(filePath) === current) fileLocks.delete(filePath);
  }
}
