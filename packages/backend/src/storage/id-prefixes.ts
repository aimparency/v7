import fs from 'fs-extra';
import path from 'node:path';
import { normalizeProjectPath } from '../project-path.js';

// Ideas and phases are files named by their id, so an id can be found from
// its beginning ("1f6f2c46") without reading any file: what agents and people
// copy from a list or a commit message.
const DIRS = ['ideas', 'archived-ideas', 'phases'];

/** Every id of the space (ideas, archived ideas, phases) that begins with each prefix. */
export async function idsBeginningWith(rawProjectPath: string, prefixes: string[]): Promise<Record<string, string[]>> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const ids = new Set<string>();
  for (const dir of DIRS) {
    const full = path.join(projectPath, dir);
    if (!await fs.pathExists(full)) continue;
    for (const file of await fs.readdir(full)) if (file.endsWith('.json')) ids.add(file.slice(0, -5));
  }
  const all = [...ids];
  return Object.fromEntries(prefixes.map((prefix) => {
    const wanted = prefix.toLowerCase();
    return [prefix, all.filter((id) => id.toLowerCase().startsWith(wanted)).sort()];
  }));
}
