// JSON file helpers shared by the .bowman migrations: atomic, idempotent rewrites.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function rewriteJson(file: string, transform: (value: unknown) => unknown): Promise<boolean> {
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

export async function listJsonFiles(dir: string): Promise<string[]> {
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

export function sameJson(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return a === b;
  }
}

export async function writeAtomic(file: string, content: string) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.migrate-${process.pid}-${Math.random().toString(16).slice(2)}`);
  await fs.writeFile(temp, content);
  await fs.rename(temp, file);
}

export async function readOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
