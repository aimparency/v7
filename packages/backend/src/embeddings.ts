import fs from 'fs-extra';
import path from 'path';
import { cosineSimilarity } from 'shared';

const PORT = process.env.PORT_EMBEDDER || '3003';
const EMBEDDER_URL = `http://127.0.0.1:${PORT}/embed`;

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    // Basic retry logic could go here, but for now fail fast
    const response = await fetch(EMBEDDER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    
    if (!response.ok) {
      console.warn(`Embedder service returned ${response.status}: ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.warn('Embedder service unreachable. Is it running?');
    return null;
  }
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
  
  if (await fs.pathExists(storePath)) {
    store = await fs.readJson(storePath);
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