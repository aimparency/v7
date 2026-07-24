import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { AIMPARENCY_DIR_NAME } from 'shared';

export function expandHome(rawPath: string): string {
  if (rawPath === '~') return os.homedir();
  if (rawPath.startsWith('~/')) return path.join(os.homedir(), rawPath.slice(2));
  return rawPath;
}

export function resolveBowmanPath(rawPath: string): string {
  const expanded = expandHome(rawPath);
  return expanded.endsWith(AIMPARENCY_DIR_NAME) ? expanded : path.join(expanded, AIMPARENCY_DIR_NAME);
}

export async function bowmanExists(rawPath: string): Promise<boolean> {
  const target = resolveBowmanPath(rawPath);
  if (await fs.pathExists(path.join(target, 'meta.json'))) return true;
  for (const dirName of ['aims', 'archived-aims']) {
    const dir = path.join(target, dirName);
    if (!(await fs.pathExists(dir))) continue;
    if ((await fs.readdir(dir)).some((file) => file.endsWith('.json'))) return true;
  }
  return false;
}

export async function completeDirectoryPath(rawPartial: string): Promise<string[]> {
  const expanded = expandHome(rawPartial);
  const endsWithSeparator = expanded.endsWith(path.sep) || expanded === '';
  const dir = endsWithSeparator ? expanded : path.dirname(expanded);
  const prefix = endsWithSeparator ? '' : path.basename(expanded);
  const listDir = dir === '' ? '.' : dir;

  try {
    const entries = await fs.readdir(listDir, { withFileTypes: true });
    const matches = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => path.join(dir, entry.name))
      .sort();
    if (!rawPartial.startsWith('~/')) return matches;
    const home = os.homedir();
    return matches.map((candidate) => candidate.startsWith(home) ? `~${candidate.slice(home.length)}` : candidate);
  } catch {
    return [];
  }
}
