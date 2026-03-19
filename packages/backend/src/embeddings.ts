import fs from 'fs-extra';
import path from 'path';
import { cosineSimilarity } from 'shared';

export const EMBEDDING_DIMENSION = 256;
const WORD_BUCKET_WEIGHT = 1.6;
const BIGRAM_BUCKET_WEIGHT = 0.8;
const TRIGRAM_BUCKET_WEIGHT = 0.35;

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    return buildLocalEmbedding(text);
  } catch (error) {
    console.warn('Local embedding generation failed:', error);
    return null;
  }
}

function buildLocalEmbedding(text: string): number[] {
  const normalized = text.toLowerCase().trim();
  const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);

  if (!normalized) {
    return vector;
  }

  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  for (const word of words) {
    if (!word) continue;
    addFeature(vector, `w:${word}`, WORD_BUCKET_WEIGHT);

    if (word.length >= 2) {
      for (let i = 0; i <= word.length - 2; i++) {
        addFeature(vector, `b:${word.slice(i, i + 2)}`, BIGRAM_BUCKET_WEIGHT);
      }
    }

    if (word.length >= 3) {
      for (let i = 0; i <= word.length - 3; i++) {
        addFeature(vector, `t:${word.slice(i, i + 3)}`, TRIGRAM_BUCKET_WEIGHT);
      }
    }
  }

  normalizeVector(vector);
  return vector;
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const unsignedHash = fnv1a(feature);
  const index = unsignedHash % EMBEDDING_DIMENSION;
  const sign = ((unsignedHash >>> 31) & 1) === 0 ? 1 : -1;
  vector[index] = (vector[index] ?? 0) + (weight * sign);
}

function normalizeVector(vector: number[]): void {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i] ?? 0;
    sumSquares += value * value;
  }

  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) {
    return;
  }

  for (let i = 0; i < vector.length; i++) {
    vector[i] = parseFloat(((vector[i] ?? 0) / magnitude).toFixed(6));
  }
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Store mappings: AimID -> Vector
export interface VectorStore {
  [aimId: string]: number[];
}

async function getVectorStorePath(projectPath: string) {
  return path.join(projectPath, '.bowman', 'vectors.json');
}

// Cache per project
const vectorCache = new Map<string, VectorStore>();

export async function loadVectorStore(projectPath: string): Promise<VectorStore> {
  if (vectorCache.has(projectPath)) {
    return vectorCache.get(projectPath)!;
  }

  const storePath = await getVectorStorePath(projectPath);
  let store: VectorStore = {};
  let needsRewrite = false;
  
  if (await fs.pathExists(storePath)) {
    const rawStore = await fs.readJson(storePath);
    for (const [aimId, vector] of Object.entries(rawStore as Record<string, unknown>)) {
      if (isStoredVector(vector)) {
        store[aimId] = vector.map(v => parseFloat(v.toFixed(6)));
      } else {
        needsRewrite = true;
      }
    }
  }

  if (needsRewrite) {
    await fs.writeJson(storePath, store, { spaces: 0 });
  }
  
  vectorCache.set(projectPath, store);
  return store;
}

export async function saveEmbedding(projectPath: string, aimId: string, vector: number[]) {
  try {
    const store = await loadVectorStore(projectPath);
    // Reduce precision to 6 decimals to save space (plenty for cosine similarity)
    store[aimId] = vector.map(v => parseFloat(v.toFixed(6)));
    // Cache is updated by reference

    const storePath = await getVectorStorePath(projectPath);
    await fs.ensureDir(path.dirname(storePath)); // Ensure .bowman directory exists
    await fs.writeJson(storePath, store, { spaces: 0 });  // Compact format (no indentation)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Failed to save embedding: Project directory might have been deleted (${projectPath})`);
    } else {
      console.error('Error saving embedding:', error);
    }
  }
}

export async function removeEmbedding(projectPath: string, aimId: string) {
  const store = await loadVectorStore(projectPath);
  if (store[aimId]) {
    delete store[aimId];
    const storePath = await getVectorStorePath(projectPath);
    await fs.writeJson(storePath, store);
  }
}

export async function searchVectors(projectPath: string, queryVector: number[], limit: number = 10): Promise<{ id: string, score: number }[]> {
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
export function invalidateVectorCache(projectPath: string): void {
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
