import fs from 'fs-extra';
import path from 'path';
import { LinkedRepoRegistrySchema } from 'shared';
import type { LinkedRepoLocal } from 'shared';
import { normalizeProjectPath } from '../project-path.js';
import { writeJsonAtomic } from './json.js';
import { ensureProjectStructure } from './project.js';

// --- Linked-repo registry -----------------------------------------------------
// Identity split: the PORTABLE part (repoId, name, url) lives in meta.linkedRepos
// and travels with the repo via git; the MACHINE-LOCAL part (where the repo is
// checked out, and read/write access) lives here in .bowman/runtime/ (gitignored)
// so committed absolute paths never break for collaborators. Resolving a
// cross-repo edge {repoId, ideaId} is two-stage: repoId → local map → load.

const LINKED_REPOS_REGISTRY_FILE = 'linked-repos.json';

function linkedRepoRegistryPath(projectPath: string): string {
  return path.join(normalizeProjectPath(projectPath), 'runtime', LINKED_REPOS_REGISTRY_FILE);
}

export async function readLinkedRepoRegistry(projectPath: string): Promise<LinkedRepoLocal[]> {
  const file = linkedRepoRegistryPath(projectPath);
  if (!(await fs.pathExists(file))) return [];
  try {
    return LinkedRepoRegistrySchema.parse(await fs.readJson(file)).repos;
  } catch {
    return [];
  }
}

export async function writeLinkedRepoRegistry(projectPath: string, repos: LinkedRepoLocal[]): Promise<void> {
  await ensureProjectStructure(projectPath);
  await writeJsonAtomic(linkedRepoRegistryPath(projectPath), { repos });
}

// Two-stage resolution: repoId → machine-local localPath (or null if this repo
// is linked but not checked out here — the 'repo-not-checked-out' state).
export async function resolveLinkedRepoLocalPath(projectPath: string, repoId: string): Promise<string | null> {
  const entry = (await readLinkedRepoRegistry(projectPath)).find((r) => r.repoId === repoId);
  return entry ? entry.localPath : null;
}
