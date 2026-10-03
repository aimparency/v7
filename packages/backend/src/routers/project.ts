import { z } from 'zod';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import type { Dirent } from 'fs';
import { fileURLToPath } from 'url';
import { observable } from '@trpc/server/observable';
import type { Idea, ProjectMeta } from 'shared';
import { CURRENT_DATA_MODEL_VERSION } from 'shared';
import { assertWritableBowman } from 'shared/bowman-migration';
import { embeddingTextForIdea } from '../embeddings.js';
import { currentOrigin } from '../change-origin.js';
import { bowmanExists, completeDirectoryPath, resolveBowmanPath } from '../path-completion.js';
import { onChange, type ChangeEvent } from '../change-events.js';
import { writeJsonAtomic } from '../storage/json.js';
import { normalizeProjectPath } from '../project-path.js';
import { ensureProjectStructure, readProjectMeta } from '../storage/project.js';
import { listIdeas, scanIdeaFiles } from '../storage/ideas.js';
import { listPhases } from '../storage/phases.js';
import { indexIdeas, indexPhases } from '../search.js';
import { loadVectorStore, hasCurrentEmbedding, generateEmbedding, saveEmbeddings } from '../embeddings.js';
import { ensureSearchIndex } from '../search-index.js';
import { t, delayedProcedure } from '../trpc.js';

const projectDiscoveryInputSchema = z.object({
  roots: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(0).max(6).optional()
});

const DISCOVERY_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo'
]);

// Vectors are stored in one JSON file, so each flush rewrites the whole store.
// Batch the startup backfill instead of paying that per idea.
const EMBEDDING_BACKFILL_FLUSH_SIZE = 25;
const EMBEDDING_BACKFILL_MAX_PAUSE_MS = 250;

const getDefaultDiscoveryRoots = () => {
  const cwd = path.resolve(process.cwd());
  const parent = path.dirname(cwd);
  return Array.from(new Set([cwd, parent, os.homedir()].filter(Boolean)));
};

const discoverProjectsFromRoot = async (
  root: string,
  maxDepth: number,
  seenProjectRoots: Set<string>,
  results: Array<{ path: string, bowmanPath: string, sourceRoot: string }>
) => {
  const visit = async (dirPath: string, depth: number): Promise<void> => {
    if (depth > maxDepth || results.length >= 50) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    const hasBowmanDir = entries.some((entry) => entry.isDirectory() && entry.name === '.bowman');
    if (hasBowmanDir && !seenProjectRoots.has(dirPath)) {
      seenProjectRoots.add(dirPath);
      results.push({
        path: dirPath,
        bowmanPath: path.join(dirPath, '.bowman'),
        sourceRoot: root
      });
    }

    if (depth === maxDepth) return;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.bowman' || DISCOVERY_IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && depth > 0) continue;

      await visit(path.join(dirPath, entry.name), depth + 1);
      if (results.length >= 50) return;
    }
  };

  await visit(root, 0);
};

export const projectRouter = t.router({
  onUpdate: t.procedure.subscription(() => {
    return observable<ChangeEvent & { origin?: string }>((emit) =>
      // Listeners run inside the emitting request's context: tag the origin
      // so clients can recognize (and undo) their own changes.
      onChange((event) => emit.next({ ...event, origin: currentOrigin() }))
    );
  }),

  getMeta: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      // Clients call getMeta first when opening a project: warm the search index
      // and vector store now so the first idea-creation search isn't the cold one.
      void Promise.all([ensureSearchIndex(input.projectPath), loadVectorStore(input.projectPath)])
        .catch(error => console.warn('[Search] Warm-up failed:', error));
      return await readProjectMeta(input.projectPath);
    }),

  discoverLocalProjects: delayedProcedure
    .input(projectDiscoveryInputSchema.optional())
    .query(async ({ input }) => {
      const roots: string[] = Array.from(
        new Set((input?.roots?.length ? input.roots : getDefaultDiscoveryRoots()).map((root: string) => path.resolve(root)))
      );
      const maxDepth = input?.maxDepth ?? 2;
      const seenProjectRoots = new Set<string>();
      const projects: Array<{ path: string, bowmanPath: string, sourceRoot: string }> = [];

      for (const root of roots) {
        await discoverProjectsFromRoot(root, maxDepth, seenProjectRoots, projects);
      }

      projects.sort((left, right) => left.path.localeCompare(right.path));

      return {
        rootsScanned: roots,
        projects
      };
    }),

  inspectPath: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ input }) => {
      const bowmanPath = resolveBowmanPath(input.projectPath);
      return {
        projectPath: input.projectPath,
        bowmanPath,
        bowmanExists: await bowmanExists(input.projectPath),
        matches: await completeDirectoryPath(input.projectPath),
      };
    }),

  buildSearchIndex: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .mutation(async ({ input }) => {
      const ideas = await listIdeas(input.projectPath);
      const phases = await listPhases(input.projectPath);

      indexIdeas(input.projectPath, ideas);
      indexPhases(input.projectPath, phases);

      // Background embedding generation
      if (process.env.NODE_ENV !== 'test') {
        (async () => {
            const vectorStore = await loadVectorStore(input.projectPath);
            const ideasToEmbed = ideas.filter((idea: Idea) => !hasCurrentEmbedding(vectorStore[idea.id]));

            if (ideasToEmbed.length > 0) {
                console.log(`Starting embedding generation for ${ideasToEmbed.length} ideas (skipped ${ideas.length - ideasToEmbed.length} existing)...`);
                // This backfill runs right after startup, while the user is already
                // working. Flush in batches (one vectors.json rewrite per batch, not
                // per idea) and yield between ideas so queued requests - e.g. creating
                // an idea - are not stuck behind the loop.
                let pending: { ideaId: string, vector: number[] }[] = [];
                for (const idea of ideasToEmbed) {
                    const startedAt = Date.now();
                    const vector = await generateEmbedding(embeddingTextForIdea(idea));
                    if (vector) {
                        pending.push({ ideaId: idea.id, vector });
                    }
                    if (pending.length >= EMBEDDING_BACKFILL_FLUSH_SIZE) {
                        await saveEmbeddings(input.projectPath, pending);
                        pending = [];
                    }
                    // Tokenization and tensor post-processing run on the JS thread and
                    // block it for tens of milliseconds per idea. Idle for roughly as
                    // long as the last idea took, so the backfill uses at most half the
                    // event loop and interactive requests keep getting served.
                    const busyMs = Date.now() - startedAt;
                    await new Promise(resolve => setTimeout(resolve, Math.min(busyMs, EMBEDDING_BACKFILL_MAX_PAUSE_MS)));
                }
                await saveEmbeddings(input.projectPath, pending);
                console.log('Embedding generation complete.');
            } else {
                console.log(`Embeddings up to date (checked ${ideas.length} ideas).`);
            }
        })().catch(console.error);
      }

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
      projectPath: z.string(),
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
      const projectPath = normalizeProjectPath(input.projectPath);
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

  injectAgentInstructions: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.projectPath);
      const rootDir = path.dirname(projectPath); // Project root (above .bowman)

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const instructionsPath = path.join(__dirname, '../agent-instruction.md');

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

  // All ideas in one read, plus the files that fail to load (the graph shows
  // them as warning nodes).
  loadIdeas: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => scanIdeaFiles(input.projectPath, ['ideas']))
});
