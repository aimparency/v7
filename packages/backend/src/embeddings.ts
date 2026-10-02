import fs from 'fs-extra';
import path from 'path';
import { cosineSimilarity } from 'shared';
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { Idea } from 'shared';
import { normalizeProjectPath } from './project-path.js';

// bge-small-en-v1.5: 384-dim sentence embeddings, native ONNX, 512-token window.
// Runs in-process via onnxruntime-node (inference on native threads, off the JS event loop).
export const EMBEDDING_DIMENSION = 384;
const MODEL_ID = 'BAAI/bge-small-en-v1.5';

// bge is an asymmetric retrieval model: documents (ideas) are embedded raw, while
// short search queries get this instruction prefix so they land near matching ideas.
// Symmetric ops (duplicate detection, reparenting, neighbours) compare raw idea
// vectors to each other and therefore must NOT use the prefix.
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID).catch(error => {
      // Reset so a later call can retry (e.g. transient download failure).
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

/**
 * Load the embedding model once, up front. Call at backend startup so the first
 * search/index request doesn't pay the cold-load cost. Safe to call repeatedly.
 */
export async function warmupEmbedder(): Promise<void> {
  try {
    await getExtractor();
  } catch (error) {
    console.warn('Embedding model warmup failed (will retry on demand):', error);
  }
}

async function embed(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) {
    return null;
  }
  try {
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array, value => Number(value));
  } catch (error) {
    console.warn('Embedding generation failed:', error);
    return null;
  }
}

/**
 * Embed an idea/document for storage. Used when creating or updating ideas.
 * Pass the combined text from {@link embeddingTextForAim}.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  return embed(text);
}

/**
 * Embed a free-text search query (asymmetric retrieval). Only for the search path,
 * never for stored idea vectors.
 */
export async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  return embed(QUERY_PREFIX + query);
}

/**
 * Build the text fed to the embedder for an idea: title + description + tags.
 * The old hash embedder only used the title; descriptions/tags are often the
 * richest signal, so we include them.
 */
export function embeddingTextForAim(idea: Pick<Idea, 'text' | 'description' | 'tags'>): string {
  const parts: string[] = [idea.text];
  if (idea.description && idea.description.trim()) {
    parts.push(idea.description.trim());
  }
  if (idea.tags && idea.tags.length > 0) {
    parts.push(idea.tags.join(', '));
  }
  return parts.join('\n\n');
}

// Store mappings: IdeaID -> Vector
export interface VectorStore {
  [ideaId: string]: number[];
}

async function getVectorStorePath(projectPath: string) {
  return path.join(normalizeProjectPath(projectPath), 'vectors.json');
}

// Cache per project
const vectorCache = new Map<string, VectorStore>();

// Simple Mutex for file operations to prevent corruption
class Mutex {
  private promise: Promise<void> = Promise.resolve();
  async acquire(): Promise<() => void> {
    let release: () => void;
    const nextPromise = new Promise<void>(resolve => {
      release = resolve;
    });
    const currentPromise = this.promise;
    this.promise = currentPromise.then(() => nextPromise);
    await currentPromise;
    return release!;
  }
}
const projectLocks = new Map<string, Mutex>();

function getProjectLock(projectPath: string): Mutex {
  if (!projectLocks.has(projectPath)) {
    projectLocks.set(projectPath, new Mutex());
  }
  return projectLocks.get(projectPath)!;
}

export async function loadVectorStore(rawProjectPath: string): Promise<VectorStore> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const lock = getProjectLock(projectPath);
  const release = await lock.acquire();
  try {
    if (vectorCache.has(projectPath)) {
      return vectorCache.get(projectPath)!;
    }

    const storePath = await getVectorStorePath(projectPath);
    let store: VectorStore = {};
    let needsRewrite = false;
    
    if (await fs.pathExists(storePath)) {
      try {
        const rawStore = await fs.readJson(storePath);
        for (const [ideaId, vector] of Object.entries(rawStore as Record<string, unknown>)) {
          if (isStoredVector(vector)) {
            // Already rounded on write (saveEmbeddings); no need to re-round on load.
            store[ideaId] = vector;
          } else {
            needsRewrite = true;
          }
        }
      } catch (e: any) {
        console.error(`Error reading vectors.json (might be corrupted), starting fresh:`, e.message);
        needsRewrite = true;
        store = {}; // reset to empty
      }
    }

    if (needsRewrite) {
      // Write to a temporary file first, then rename for atomic write
      const tempPath = `${storePath}.tmp`;
      await fs.ensureDir(path.dirname(storePath));
      await fs.writeJson(tempPath, store, { spaces: 0 });
      await fs.rename(tempPath, storePath);
    }
    
    vectorCache.set(projectPath, store);
    return store;
  } finally {
    release();
  }
}

export async function saveEmbedding(projectPath: string, ideaId: string, vector: number[]) {
  return saveEmbeddings(projectPath, [{ ideaId, vector }]);
}

/**
 * Persist several vectors with a single rewrite of vectors.json.
 *
 * The store is one JSON file, so every save serializes and writes all of it
 * (megabytes once a project has a few hundred ideas). Saving per idea inside a
 * backfill loop is quadratic and stalls the event loop in long synchronous
 * stringify bursts, which shows up as multi-second latency on unrelated
 * requests. Batch the writes instead; the in-memory cache is updated up front,
 * so searches see the new vectors before the file lands.
 */
export async function saveEmbeddings(rawProjectPath: string, entries: { ideaId: string, vector: number[] }[]) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  if (entries.length === 0) return;
  const store = await loadVectorStore(projectPath);
  const lock = getProjectLock(projectPath);
  const release = await lock.acquire();
  try {
    for (const { ideaId, vector } of entries) {
      // Reduce precision to 6 decimals to save space (plenty for cosine similarity)
      store[ideaId] = vector.map(v => parseFloat(v.toFixed(6)));
      // Cache is updated by reference
    }

    const storePath = await getVectorStorePath(projectPath);
    const tempPath = `${storePath}.tmp`;
    await fs.ensureDir(path.dirname(storePath)); // Ensure .bowman directory exists
    // Write atomically
    await fs.writeJson(tempPath, store, { spaces: 0 });  // Compact format (no indentation)
    await fs.rename(tempPath, storePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Failed to save embedding: Project directory might have been deleted (${projectPath})`);
    } else {
      console.error('Error saving embedding:', error);
    }
  } finally {
    release();
  }
}

export async function removeEmbedding(rawProjectPath: string, ideaId: string) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const store = await loadVectorStore(projectPath);
  if (store[ideaId]) {
    const lock = getProjectLock(projectPath);
    const release = await lock.acquire();
    try {
      delete store[ideaId];
      const storePath = await getVectorStorePath(projectPath);
      const tempPath = `${storePath}.tmp`;
      await fs.writeJson(tempPath, store);
      await fs.rename(tempPath, storePath);
    } finally {
      release();
    }
  }
}

export async function searchVectors(rawProjectPath: string, queryVector: number[], limit: number = 10): Promise<{ id: string, score: number }[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const store = await loadVectorStore(projectPath);
  const results = [];

  for (const [id, vector] of Object.entries(store)) {
    if (vector.length !== queryVector.length) {
      continue;
    }
    const score = cosineSimilarity(queryVector, vector);
    results.push({ id, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Invalidate the vector store cache for a project.
 * Call this when vectors.json is modified externally or needs to be reloaded.
 */
export function invalidateVectorCache(rawProjectPath: string): void {
  const projectPath = normalizeProjectPath(rawProjectPath);
  vectorCache.delete(projectPath);
}

export function hasCurrentEmbedding(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === EMBEDDING_DIMENSION
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function isStoredVector(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}
