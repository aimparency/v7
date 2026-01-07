import fs from 'fs-extra';
import path from 'path';
import { loadVectorStore } from './embeddings.js';

interface SemanticLink {
  source: string;
  target: string;
  distance: number;
  type: 'nearest' | 'furthest';
}

interface SemanticGraph {
  links: SemanticLink[];
  averageDistance: number;
  lastUpdated: number;
}

const semanticCache = new Map<string, SemanticGraph>();

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function getSemanticGraph(projectPath: string): Promise<SemanticGraph> {
  const cacheKey = projectPath;
  
  // 1. Check Memory Cache
  if (semanticCache.has(cacheKey)) {
    // TODO: check timestamp against vectors.json
    return semanticCache.get(cacheKey)!;
  }

  // 2. Check Disk Cache
  const cacheFile = path.join(projectPath, 'semantic-graph.json');
  if (await fs.pathExists(cacheFile)) {
    const diskGraph = await fs.readJson(cacheFile);
    // basic check to see if it's stale? For now, trust it.
    semanticCache.set(cacheKey, diskGraph);
    // return diskGraph; // Actually let's force re-calc for now to be safe
  }

  // 3. Recalculate
  return await calculateSemanticGraph(projectPath);
}

export async function calculateSemanticGraph(projectPath: string): Promise<SemanticGraph> {
  const store = await loadVectorStore(projectPath);
  const ids = Object.keys(store);
  const links: SemanticLink[] = [];
  
  if (ids.length < 2) {
    return { links: [], averageDistance: 0, lastUpdated: Date.now() };
  }

  // Helper to get distance (0 = identical, 2 = opposite)
  const getDist = (idA: string, idB: string) => {
    const vecA = store[idA];
    const vecB = store[idB];
    if (!vecA || !vecB) return 1;
    const sim = cosineSimilarity(vecA, vecB);
    return 1 - sim;
  };

  const addLink = (a: string, b: string, dist: number, type: 'nearest' | 'furthest') => {
    // Allow mutual links (if A->B and B->A both exist, force applies twice)
    links.push({ source: a, target: b, distance: dist, type });
  };

  // Brute force N^2 for now (fine for < 2000 aims)
  for (const idA of ids) {
    const candidates: { id: string, dist: number }[] = [];
    
    for (const idB of ids) {
      if (idA === idB) continue;
      candidates.push({ id: idB, dist: getDist(idA, idB) });
    }

    // Sort by distance
    candidates.sort((a, b) => a.dist - b.dist);

    // Top 3 Nearest
    for (let i = 0; i < Math.min(3, candidates.length); i++) {
      const item = candidates[i];
      if (item) addLink(idA, item.id, item.dist, 'nearest');
    }

    // Top 3 Furthest
    for (let i = 0; i < Math.min(3, candidates.length); i++) {
        const item = candidates[candidates.length - 1 - i];
        if (item) addLink(idA, item.id, item.dist, 'furthest');
    }
  }

  // Calculate Average of selected links
  const totalDist = links.reduce((sum, link) => sum + link.distance, 0);
  const avg = links.length > 0 ? totalDist / links.length : 0;

  const result: SemanticGraph = {
    links,
    averageDistance: avg,
    lastUpdated: Date.now()
  };

  // Save to disk
  const cacheFile = path.join(projectPath, 'semantic-graph.json');
  await fs.writeJson(cacheFile, result);
  
  semanticCache.set(projectPath, result);
  return result;
}
