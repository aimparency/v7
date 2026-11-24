import fs from 'fs-extra';
import path from 'node:path';

// How alive a space is: how many ideas it has, how many are open, when an idea
// last changed. Counts only, never an idea's content, so it may be read for a
// linked space without breaking its black box.
export type SpaceActivity = { ideas: number, open: number, lastChange?: string };

const OPEN_STATES = new Set(['open', 'partially']);
export const readSpaceActivity = async (bowmanPath: string): Promise<SpaceActivity> => {
  const directory = path.join(bowmanPath, 'ideas');
  let files: string[];
  try {
    files = (await fs.readdir(directory)).filter(file => file.endsWith('.json'));
  } catch {
    return { ideas: 0, open: 0 };
  }
  let open = 0;
  let last = 0;
  for (const file of files) {
    try {
      const filePath = path.join(directory, file);
      const [content, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      if (OPEN_STATES.has((JSON.parse(content) as { status?: { state?: string } }).status?.state ?? '')) open++;
      last = Math.max(last, stat.mtimeMs);
    } catch {
      // An unreadable idea file counts as an idea, not as open.
    }
  }
  return { ideas: files.length, open, ...(last ? { lastChange: new Date(last).toISOString() } : {}) };

};
