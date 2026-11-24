import { z } from 'zod';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import type { Dirent } from 'fs';
import { packageRoot } from 'shared/node-entry';
import { observable } from '@trpc/server/observable';
import type { ProjectMeta } from 'shared';
import { CURRENT_DATA_MODEL_VERSION, LayoutSettingsSchema } from 'shared';
import { assertWritableBowman, bowmanWriteBlocker } from 'shared/bowman-migration';
import { currentOrigin } from '../change-origin.js';
import { bowmanExists, completeDirectoryPath, resolveBowmanPath } from '../path-completion.js';
import { onChange, type ChangeEvent } from '../change-events.js';
import { onProjectLoadProgress, reportProjectLoadProgress, type ProjectLoadProgress } from '../project-load-progress.js';
import { writeJsonAtomic } from '../storage/json.js';
import { normalizeProjectPath } from '../project-path.js';
import { readOnlyReason, rightOn, viewerFor } from '../auth/access.js';
import { openGitRepository } from '../git-repository-cache.js';
import { ensureProjectStructure, readProjectMeta, updateProjectMeta } from '../storage/project.js';
import { listIdeas, scanIdeaFiles } from '../storage/ideas.js';
import { listPhases } from '../storage/phases.js';
import { indexIdeas, indexPhases } from '../search.js';
import { loadVectorStore } from '../embeddings.js';
import { backfillEmbeddings, ensureEmbeddings } from '../embedding-backfill.js';
import { ensureSearchIndex } from '../search-index.js';
import { t, procedure, delayedProcedure } from '../trpc.js';
import { findSpaceByPath } from '../spaces/registry.js';
import { readSpaceActivity } from '../spaces/activity.js';
import { spaceAddress, resolveSpaceAddress } from '../spaces/address.js';

const projectDiscoveryInputSchema = z.object({
  roots: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(0).max(8).optional(),
  // A space that moved: only the spaces with this id, or (as suggestions) this
  // folder or space name, are listed.
  repoId: z.string().optional(),
  name: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  // How alive each space is: counts and the last change, never its ideas' content.
  details: z.boolean().optional()
});

type SpaceOnDisk = {
  path: string, bowmanPath: string, sourceRoot: string,
  name?: string, repoId?: string,
  /** With a repoId or name to look for: which of them this space matched. */
  matchedBy?: 'id' | 'name'
  ideas?: number, open?: number, lastChange?: string
};
type DiscoveryFilter = { repoId?: string, name?: string, limit: number, details?: boolean };

const DISCOVERY_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.test-tmp' // projects that backend tests create (and an interrupted run leaves behind)
]);


const getDefaultDiscoveryRoots = () => {
  const cwd = path.resolve(process.cwd());
  const parent = path.dirname(cwd);
  return Array.from(new Set([cwd, parent, os.homedir()].filter(Boolean)));
};

// A space's own name and id, from its meta.json; absent when it has none.
const readIdentity = async (bowmanPath: string): Promise<{ name?: string, repoId?: string }> => {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(bowmanPath, 'meta.json'), 'utf8')) as { name?: unknown, repoId?: unknown };
    return {
      ...(typeof meta.name === 'string' && meta.name ? { name: meta.name } : {}),
      ...(typeof meta.repoId === 'string' && meta.repoId ? { repoId: meta.repoId } : {})
    };
  } catch {
    return {};
  }
};

const matchOf = (found: SpaceOnDisk, filter: DiscoveryFilter): SpaceOnDisk['matchedBy'] | null => {
  if (!filter.repoId && !filter.name) return undefined;
  if (filter.repoId && found.repoId === filter.repoId) return 'id';
  const name = filter.name?.trim().toLowerCase();
  if (name && [path.basename(found.path), found.name ?? ''].some(candidate => candidate.toLowerCase() === name)) return 'name';
  return null;
};

const discoverProjectsFromRoot = async (
  root: string,
  maxDepth: number,
  seenProjectRoots: Set<string>,
  results: SpaceOnDisk[],
  filter: DiscoveryFilter
) => {
  const visit = async (dirPath: string, depth: number): Promise<void> => {
    if (depth > maxDepth || results.length >= filter.limit) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    const hasBowmanDir = entries.some((entry) => entry.isDirectory() && entry.name === '.bowman');
    if (hasBowmanDir && !seenProjectRoots.has(dirPath)) {
      seenProjectRoots.add(dirPath);
      const bowmanPath = path.join(dirPath, '.bowman');
      const found: SpaceOnDisk = { path: dirPath, bowmanPath, sourceRoot: root, ...await readIdentity(bowmanPath) };
      const matchedBy = matchOf(found, filter);
      if (matchedBy !== null) {
        results.push({ ...found, ...(matchedBy ? { matchedBy } : {}), ...(filter.details ? await readSpaceActivity(bowmanPath) : {}) });
      }
    }

    if (depth === maxDepth) return;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.bowman' || DISCOVERY_IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && depth > 0) continue;

      await visit(path.join(dirPath, entry.name), depth + 1);
      if (results.length >= filter.limit) return;
    }
  };

  await visit(root, 0);
};

export const projectRouter = t.router({
  // One space's changes. The client gets its own address back, never the
  // directory on the server.
  onUpdate: procedure
    .input(z.object({ space: z.string() }))
    .subscription(({ input }) => {
      const spacePath = normalizeProjectPath(resolveSpaceAddress(input.space).path);
      return observable<ChangeEvent & { origin?: string }>((emit) =>
        // Listeners run inside the emitting request's context: tag the origin
        // so clients can recognize (and undo) their own changes.
        onChange((event) => {
          if (normalizeProjectPath(event.projectPath) !== spacePath) return;
          emit.next({ ...event, projectPath: input.space, origin: currentOrigin() });
        })
      );
    }),

  getMeta: delayedProcedure
    .input(z.object({
      space: spaceAddress
    }))
    .query(async ({ ctx, input }) => {
      // Clients call getMeta first when opening a project: warm the search index
      // and vector store now so the first idea-creation search isn't the cold
      // one, and embed ideas that have no current embedding yet. Embedding costs
      // the server, so only those who write the space set it off: a visitor
      // opening many spaces must not keep the server busy.
      void Promise.all([ensureSearchIndex(input.space), loadVectorStore(input.space)])
        .catch(error => console.warn('[Search] Warm-up failed:', error));
      const writes = rightOn(findSpaceByPath(input.space), ctx.viewer ?? viewerFor(ctx.session?.token)) !== 'read';
      if (writes && process.env.NODE_ENV !== 'test') void ensureEmbeddings(input.space).catch(console.error);
      return await readProjectMeta(input.space);
    }),

  // Whether the space may be changed here; the UI disables editing otherwise.
  getAccess: delayedProcedure
    .input(z.object({
      space: spaceAddress
    }))
    .query(async ({ ctx, input }) => {
      const blocker = await bowmanWriteBlocker(normalizeProjectPath(input.space));
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      const space = findSpaceByPath(input.space);
      const reason = blocker?.message ?? readOnlyReason(space, viewer);
      return { writable: reason === null, reason, user: viewer.name, role: rightOn(space, viewer), serverAdmin: viewer.serverAdmin };
    }),

  // Someone else's project by Git URL: cached clone of its .bowman, read-only.
  openGitUrl: delayedProcedure
    .input(z.object({
      url: z.string().min(1)
    }))
    .mutation(async ({ input }) => ({ projectPath: await openGitRepository(input.url) })),

  discoverLocalProjects: delayedProcedure
    .input(projectDiscoveryInputSchema.optional())
    .query(async ({ input }) => {
      const roots: string[] = Array.from(
        new Set((input?.roots?.length ? input.roots : getDefaultDiscoveryRoots()).map((root: string) => path.resolve(root)))
      );
      const maxDepth = input?.maxDepth ?? 2;
      const filter: DiscoveryFilter = { repoId: input?.repoId, name: input?.name, limit: input?.limit ?? 50, details: input?.details };
      const seenProjectRoots = new Set<string>();
      const projects: SpaceOnDisk[] = [];

      for (const root of roots) {
        await discoverProjectsFromRoot(root, maxDepth, seenProjectRoots, projects, filter);
      }

      // Matches by id first: those are the space itself, a name is only a guess.
      projects.sort((left, right) => Number(left.matchedBy === 'name') - Number(right.matchedBy === 'name') || left.path.localeCompare(right.path));

      return {
        rootsScanned: roots,
        projects
      };
    }),

  inspectPath: delayedProcedure
    .input(z.object({ space: spaceAddress }))
    .query(async ({ input }) => {
      const bowmanPath = resolveBowmanPath(input.space);
      return {
        projectPath: input.space,
        bowmanPath,
        bowmanExists: await bowmanExists(input.space),
        matches: await completeDirectoryPath(input.space),
      };
    }),

  buildSearchIndex: delayedProcedure
    .input(z.object({
      space: spaceAddress
    }))
    .mutation(async ({ input }) => {
      const ideas = await listIdeas(input.space);
      const phases = await listPhases(input.space);

      indexIdeas(input.space, ideas);
      indexPhases(input.space, phases);

      // Background embedding generation
      if (process.env.NODE_ENV !== 'test') void backfillEmbeddings(input.space).catch(console.error);

      return {
        success: true,
        indexed: {
          ideas: ideas.length,
          phases: phases.length
        }
      };
    }),

  updateMeta: delayedProcedure
    .input(z.object({
      space: spaceAddress,
      meta: z.object({
        name: z.string(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        statuses: z.array(z.any()).optional(),
        initialInstructions: z.string().optional(),
        supervisorGuidancePrefix: z.string().optional(),
        costUnit: z.string().optional(),
        defaultCost: z.number().finite().positive('Default cost must be greater than 0').optional(),
        dataModelVersion: z.number().int().positive().optional(),
        phaseCursors: z.record(z.string(), z.string()).optional(),
        phaseActiveLevel: z.number().int().min(0).optional(),
        rootPhaseIds: z.array(z.string()).optional()
      })
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.space);
      await ensureProjectStructure(projectPath);
      const metaPath = path.join(projectPath, 'meta.json');
      // Preserve fields the editor doesn't send (repoId, linkedRepos, …) by
      // merging onto the existing meta rather than overwriting it wholesale.
      const existing: ProjectMeta = (await fs.pathExists(metaPath))
        ? await fs.readJson(metaPath)
        : ({} as ProjectMeta);
      await assertWritableBowman(projectPath);
      // The storage format is the backend's business: an editor (possibly an
      // old tab) never sets it, so it can't roll a migrated project back.
      const nextMeta = {
        ...existing,
        ...input.meta,
        dataModelVersion: existing.dataModelVersion ?? CURRENT_DATA_MODEL_VERSION
      };
      await writeJsonAtomic(metaPath, nextMeta);
      return nextMeta;
    }),

  // The graph's Layout panel stores the settings it applied with.
  setLayoutSettings: delayedProcedure
    .input(z.object({
      space: spaceAddress,
      layout: LayoutSettingsSchema
    }))
    .mutation(async ({ input }) => {
      return await updateProjectMeta(input.space, meta => ({ ...meta, layout: input.layout }));
    }),

  injectAgentInstructions: delayedProcedure
    .input(z.object({
      space: spaceAddress
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.space);
      await assertWritableBowman(projectPath); // writes into the repository itself
      const rootDir = path.dirname(projectPath); // Project root (above .bowman)

      const instructionsPath = path.join(packageRoot(import.meta.url), 'src', 'agent-instruction.md');

      if (!(await fs.pathExists(instructionsPath))) {
          throw new Error(`Agent instructions file not found at ${instructionsPath}`);
      }

      const agentInstructions = await fs.readFile(instructionsPath, 'utf-8');

      const geminiConfig = path.join(rootDir, '.gemini/GEMINI.md');
      const claudeConfig = path.join(rootDir, 'CLAUDE.md');
      const cursorConfig = path.join(rootDir, '.cursorrules');

      const results: string[] = [];

      async function inject(filePath: string, name: string) {
          try {
              if (await fs.pathExists(filePath)) {
                  let content = await fs.readFile(filePath, 'utf-8');
                  const markerStart = '--- Context from: Aimparency ---';
                  const markerEnd = '--- End of Context from: Aimparency ---';
                  const block = `\n${markerStart}\n${agentInstructions}\n${markerEnd}\n`;

                  const regex = new RegExp(`${markerStart.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[\\s\\S]*?${markerEnd.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`, 'g');

                  if (regex.test(content)) {
                      content = content.replace(regex, block.trim());
                      results.push(`Updated ${name}`);
                  } else {
                      content += block;
                      results.push(`Appended to ${name}`);
                  }
                  await fs.writeFile(filePath, content, 'utf-8');
              }
          } catch (e) {
              results.push(`Failed to update ${name}: ${e instanceof Error ? e.message : String(e)}`);
          }
      }

      await inject(geminiConfig, 'GEMINI.md');
      await inject(claudeConfig, 'CLAUDE.md');
      await inject(cursorConfig, '.cursorrules');

      return { results };
    }),

  // All ideas in one read, plus the files that fail to load (the space shows
  // them as warning nodes).
  loadIdeas: delayedProcedure
    .input(z.object({
      space: spaceAddress
    }))
    .query(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.space);
      return scanIdeaFiles(projectPath, ['ideas'], (done, total) => reportProjectLoadProgress({ projectPath, done, total }));
    }),

  onLoadProgress: procedure
    .input(z.object({ space: spaceAddress }))
    .subscription(({ input }) => {
      const projectPath = normalizeProjectPath(input.space);
      return observable<Pick<ProjectLoadProgress, 'done' | 'total'>>((emit) =>
        onProjectLoadProgress(({ projectPath: loading, done, total }) => { if (loading === projectPath) emit.next({ done, total }); }));
    })
});
