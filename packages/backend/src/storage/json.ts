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
