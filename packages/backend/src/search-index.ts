import { normalizeProjectPath } from './project-path.js';
import { indexIdeas, indexPhases } from './search.js';
import { listIdeas } from './storage/ideas.js';
import { listPhases } from './storage/phases.js';

const searchIndexBuilds = new Map<string, Promise<void>>();

export function ensureSearchIndex(projectPath: string): Promise<void> {
  // Normalize path for consistent cache key
  const normalizedPath = normalizeProjectPath(projectPath);
  let build = searchIndexBuilds.get(normalizedPath);
  if (!build) {
    build = (async () => {
      console.log(`[Search] Building index for ${normalizedPath}...`);
      const [ideas, phases] = await Promise.all([listIdeas(normalizedPath), listPhases(normalizedPath)]);
      indexIdeas(normalizedPath, ideas);
      indexPhases(normalizedPath, phases);
    })();
    // A failed build must not stick; the next caller retries.
    build.catch(() => searchIndexBuilds.delete(normalizedPath));
    searchIndexBuilds.set(normalizedPath, build);
  }
  return build;
}
