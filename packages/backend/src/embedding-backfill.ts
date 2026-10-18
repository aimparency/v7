import type { Idea } from 'shared';
import { embeddingTextForIdea, generateEmbedding, hasCurrentEmbedding, loadVectorStore, saveEmbeddings } from './embeddings.js';
import { normalizeProjectPath } from './project-path.js';
import { listIdeas } from './storage/ideas.js';

// Embeds every idea without a current embedding: new ones, and leftovers of
// an older embedder (another dimension), which semantic search and the
// autolayout's similarity pull ignore.

// One cache transaction (and one neighbour update) per batch, not per idea.
const FLUSH_SIZE = 25;
const MAX_PAUSE_MS = 250;

const running = new Map<string, Promise<void>>();
const checked = new Set<string>();

/** Once per project and process: when a client opens the project. */
export function ensureEmbeddings(rawProjectPath: string): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  if (checked.has(projectPath)) return running.get(projectPath) ?? Promise.resolve();
  checked.add(projectPath);
  return backfillEmbeddings(projectPath);
}

/** Runs now, unless a backfill of this project is already running. */
export function backfillEmbeddings(rawProjectPath: string): Promise<void> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  let backfill = running.get(projectPath);
  if (!backfill) {
    backfill = run(projectPath).finally(() => running.delete(projectPath));
    running.set(projectPath, backfill);
  }
  return backfill;
}

async function run(projectPath: string) {
  const [ideas, vectorStore] = await Promise.all([listIdeas(projectPath), loadVectorStore(projectPath)]);
  const ideasToEmbed = ideas.filter((idea: Idea) => !hasCurrentEmbedding(vectorStore[idea.id]));
  if (ideasToEmbed.length === 0) {
    console.log(`Embeddings up to date (checked ${ideas.length} ideas).`);
    return;
  }
  console.log(`Starting embedding generation for ${ideasToEmbed.length} ideas in ${projectPath} (skipped ${ideas.length - ideasToEmbed.length} existing)...`);
  // This backfill runs while the user is already working. Flush in batches
  // and yield between ideas so queued requests - e.g. creating an idea - are
  // not stuck behind the loop.
  let pending: { ideaId: string, vector: number[] }[] = [];
  for (const idea of ideasToEmbed) {
    const startedAt = Date.now();
    const vector = await generateEmbedding(embeddingTextForIdea(idea));
    if (vector) pending.push({ ideaId: idea.id, vector });
    if (pending.length >= FLUSH_SIZE) {
      await saveEmbeddings(projectPath, pending);
      pending = [];
    }
    // Tokenization and tensor post-processing run on the JS thread and block
    // it for tens of milliseconds per idea. Idle for roughly as long as the
    // last idea took, so the backfill uses at most half the event loop and
    // interactive requests keep getting served.
    const busyMs = Date.now() - startedAt;
    await new Promise(resolve => setTimeout(resolve, Math.min(busyMs, MAX_PAUSE_MS)));
  }
  await saveEmbeddings(projectPath, pending);
  console.log('Embedding generation complete.');
}
