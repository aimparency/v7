import fs from 'fs-extra';
import path from 'path';
import Database from 'better-sqlite3';
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { CACHE_DATABASE_FILE_NAME, CACHE_DIR_NAME, cosineSimilarity, type Idea } from 'shared';
import { normalizeBowmanPath } from './loop-state.js';

const MODEL_ID = 'BAAI/bge-small-en-v1.5';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID).catch((error) => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

export async function embedSearchQuery(text: string): Promise<number[] | null> {
  if (!text.trim()) return null;
  try {
    const extractor = await getExtractor();
    const output = await extractor(QUERY_PREFIX + text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array, (value) => Number(value));
  } catch {
    return null;
  }
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const flat = Array.from(output.data as Float32Array, (value) => Number(value));
  const dimension = flat.length / texts.length;
  return texts.map((_, index) => flat.slice(index * dimension, (index + 1) * dimension));
}

// Read-only from the backend's cache database (WAL: never blocks its writes).
async function readVectorStore(projectPath: string): Promise<Record<string, number[]>> {
  const databasePath = path.join(normalizeBowmanPath(projectPath), CACHE_DIR_NAME, CACHE_DATABASE_FILE_NAME);
  if (!(await fs.pathExists(databasePath))) return {};
  let db: Database.Database | null = null;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    const store: Record<string, number[]> = {};
    for (const { id, vector } of db.prepare('SELECT id, vector FROM vectors').all() as { id: string, vector: Buffer }[]) {
      store[id] = Array.from(new Float32Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength)));
    }
    return store;
  } catch {
    return {};
  } finally {
    db?.close();
  }
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

type AssociationCandidate = {
  id: string;
  score: number;
  idea: { id: string; text: string; description?: string; status?: unknown };
};

export function selectAssociation(
  candidates: AssociationCandidate[],
  chance: number,
  random: () => number = Math.random,
  excludeIdeaIds: string[] = []
) {
  const boundedChance = Math.max(0, Math.min(chance, 1));
  const excluded = new Set(excludeIdeaIds);
  const eligible = candidates.filter((candidate) => !excluded.has(candidate.id));
  if (boundedChance <= 0 || eligible.length === 0) return null;
  const best = eligible[0];
  const threshold = quantile(eligible.map((row) => row.score), 1 - boundedChance);
  if (best.score < threshold || random() >= boundedChance) return null;
  return {
    id: best.idea.id,
    text: best.idea.text,
    description: best.idea.description,
    status: best.idea.status,
    score: Number(best.score.toFixed(4)),
    threshold: Number(threshold.toFixed(4)),
    chance: boundedChance
  };
}

export async function maybeFindAssociation(
  projectPath: string,
  loadIdeas: () => Promise<Idea[]>,
  stateText: string,
  chance = 0.1,
  excludeIdeaIds: string[] = []
) {
  const boundedChance = Math.max(0, Math.min(chance, 1));
  if (boundedChance <= 0 || !stateText.trim()) return null;
  const queryVector = await embedSearchQuery(stateText);
  if (!queryVector) return null;
  const [vectors, ideas] = await Promise.all([
    readVectorStore(projectPath),
    loadIdeas()
  ]);
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const scored = Object.entries(vectors)
    .filter(([, vector]) => vector.length === queryVector.length)
    .map(([id, vector]) => ({ id, score: cosineSimilarity(queryVector, vector), idea: ideaById.get(id) }))
    .filter((row) => row.idea && !row.idea.archived)
    .sort((left, right) => right.score - left.score);
  return selectAssociation(scored as AssociationCandidate[], boundedChance, Math.random, excludeIdeaIds);
}
