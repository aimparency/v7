import { cosineSimilarity } from 'shared';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import type { Idea } from 'shared';
import { normalizeProjectPath } from './project-path.js';
import { bumpVectorsVersion, decodeVector, encodeVector, getDb } from './db.js';

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
    // Loaded on first use: the runtime and model cost ~250 MB and ~1 s, which a
    // session that never searches shouldn't pay.
    extractorPromise = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', MODEL_ID)
    ).catch(error => {
      // Reset so a later call can retry (e.g. transient download failure).
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
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
 * Pass the combined text from {@link embeddingTextForIdea}.
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
export function embeddingTextForIdea(idea: Pick<Idea, 'text' | 'description' | 'tags'>): string {
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

// In-memory copy per project, loaded once from the cache database.
const vectorCache = new Map<string, VectorStore>();

export type VectorChange = { projectPath: string, changed: Map<string, Float32Array>, removed: string[], version: number };
const vectorListeners = new Set<(change: VectorChange) => void>();

/** Called after every committed vector write (the semantic neighbours update incrementally). */
export function onVectorsChanged(listener: (change: VectorChange) => void): () => void {
  vectorListeners.add(listener);
  return () => vectorListeners.delete(listener);
}

export async function loadVectorStore(rawProjectPath: string): Promise<VectorStore> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const cached = vectorCache.get(projectPath);
  if (cached) return cached;
  const store: VectorStore = {};
  const rows = getDb(projectPath).prepare('SELECT id, vector FROM vectors').all() as { id: string, vector: Buffer }[];
  for (const { id, vector } of rows) store[id] = Array.from(decodeVector(vector));
  vectorCache.set(projectPath, store);
  return store;
}

export async function saveEmbedding(projectPath: string, ideaId: string, vector: number[]) {
  return saveEmbeddings(projectPath, [{ ideaId, vector }]);
}

/** Persist several vectors in one transaction (one row each). */
export async function saveEmbeddings(rawProjectPath: string, entries: { ideaId: string, vector: number[] }[]) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  if (entries.length === 0) return;
  const store = await loadVectorStore(projectPath);
  const changed = new Map(entries.map(({ ideaId, vector }) => [ideaId, Float32Array.from(vector)]));
  let version: number;
  try {
    const db = getDb(projectPath);
    const upsert = db.prepare('INSERT OR REPLACE INTO vectors (id, vector) VALUES (?, ?)');
    version = db.transaction(() => {
      for (const [ideaId, vector] of changed) upsert.run(ideaId, encodeVector(vector));
      return bumpVectorsVersion(db);
    })();
  } catch (error: any) {
    console.error('Error saving embedding:', error);
    return;
  }
  for (const [ideaId, vector] of changed) store[ideaId] = Array.from(vector);
  notify({ projectPath, changed, removed: [], version });
}

export async function removeEmbedding(rawProjectPath: string, ideaId: string) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const store = await loadVectorStore(projectPath);
  if (!store[ideaId]) return;
  const db = getDb(projectPath);
  const version = db.transaction(() => {
    db.prepare('DELETE FROM vectors WHERE id = ?').run(ideaId);
    return bumpVectorsVersion(db);
  })();
  delete store[ideaId];
  notify({ projectPath, changed: new Map(), removed: [ideaId], version });
}

function notify(change: VectorChange) {
  for (const listener of vectorListeners) {
    try {
      listener(change);
    } catch (error) {
      console.error('Vector change listener failed:', error);
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

/** Drop the in-memory copy so the next load reads the cache database again. */
export function invalidateVectorCache(rawProjectPath: string): void {
  const projectPath = normalizeProjectPath(rawProjectPath);
  vectorCache.delete(projectPath);
}

export function hasCurrentEmbedding(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === EMBEDDING_DIMENSION
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}
