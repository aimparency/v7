import fs from 'fs-extra';
import path from 'path';

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
