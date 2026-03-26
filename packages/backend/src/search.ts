import { Document } from 'flexsearch';
import Fuse from 'fuse.js';
import type { Aim, Phase, SearchAimResult } from 'shared';

// FlexSearch indices per project
const aimIndices = new Map<string, Document<Aim>>();
const phaseIndices = new Map<string, Document<Phase>>();

// ... existing getAimIndex ...
function getAimIndex(projectPath: string): Document<Aim> {
  if (!aimIndices.has(projectPath)) {
    const index = new Document<Aim>({
      document: {
        id: 'id',
        index: ['text', 'status.state'] as any
      },
      tokenize: 'full',
      cache: true
    });
    aimIndices.set(projectPath, index);
  }
  return aimIndices.get(projectPath)!;
}

// ... existing getPhaseIndex ...
function getPhaseIndex(projectPath: string): Document<Phase> {
  if (!phaseIndices.has(projectPath)) {
    const index = new Document<Phase>({
      document: {
        id: 'id',
        index: ['name']
      },
      tokenize: 'full',
      cache: true,
      context: {
        resolution: 9,
        depth: 3,
        bidirectional: true
      }
    });
    phaseIndices.set(projectPath, index);
  }
  return phaseIndices.get(projectPath)!;
}

// ... existing index/update/remove functions ...
export function indexAims(projectPath: string, aims: Aim[]): void {
  const index = getAimIndex(projectPath);
  for (const aim of aims) index.remove(aim.id);
  for (const aim of aims) index.add(aim);
}

export function indexPhases(projectPath: string, phases: Phase[]): void {
  const index = getPhaseIndex(projectPath);
  for (const phase of phases) index.remove(phase.id);
  for (const phase of phases) index.add(phase);
}

export function addAimToIndex(projectPath: string, aim: Aim): void {
  const index = getAimIndex(projectPath);
  index.add(aim);
}

export function updateAimInIndex(projectPath: string, aim: Aim): void {
  const index = getAimIndex(projectPath);
  index.update(aim);
}

export function removeAimFromIndex(projectPath: string, aimId: string): void {
  const index = getAimIndex(projectPath);
  index.remove(aimId);
}

export function addPhaseToIndex(projectPath: string, phase: Phase): void {
  const index = getPhaseIndex(projectPath);
  index.add(phase);
}

export function updatePhaseInIndex(projectPath: string, phase: Phase): void {
  const index = getPhaseIndex(projectPath);
  index.update(phase);
}

export function removePhaseFromIndex(projectPath: string, phaseId: string): void {
  const index = getPhaseIndex(projectPath);
  index.remove(phaseId);
}

// Search aims by text (FlexSearch)
export async function searchAims(projectPath: string, query: string, allAims: Aim[]): Promise<SearchAimResult[]> {
  if (!query.trim()) {
    return []; // Return empty if no query, consistent with search behavior
  }

  const index = getAimIndex(projectPath);
  const results = await index.searchAsync(query, { limit: 100 });

  // FlexSearch returns array of results with field name
  const aimIds = new Set<string>();
  const scores = new Map<string, number>();

  // Aggregate results and assign scores based on rank
  let rank = 0;
  for (const result of results) {
    if (Array.isArray(result.result)) {
      result.result.forEach(id => {
        const aimId = id as string;
        if (!aimIds.has(aimId)) {
          aimIds.add(aimId);
          // Synthetic score: 1.0 for top result, decaying by 0.05
          scores.set(aimId, Math.max(0.1, 1.0 - (rank * 0.05)));
          rank++;
        }
      });
    }
  }

  // Return aims in order of search results with scores
  return allAims
    .filter(aim => aimIds.has(aim.id))
    .map(aim => ({
      ...aim,
      score: scores.get(aim.id)
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

// Search phases by name (Fuzzy search using Fuse.js)
export async function searchPhases(projectPath: string, query: string, allPhases: Phase[]): Promise<Phase[]> {
  if (!query.trim()) {
    return allPhases;
  }

  // Configure Fuse.js for fuzzy matching
  const fuse = new Fuse(allPhases, {
    keys: ['name'],
    threshold: 0.4, // 0.0 = exact match, 1.0 = match anything
    distance: 100,  // Maximum distance for fuzzy match
    minMatchCharLength: 1,
    includeScore: true,
    ignoreLocation: true, // Don't prioritize matches at start
    findAllMatches: true
  });

  const results = fuse.search(query);

  // Return phases sorted by relevance score
  return results.map(result => result.item);
}

// Clear indices for a project (e.g., when project is closed)
export function clearIndices(projectPath: string): void {
  aimIndices.delete(projectPath);
  phaseIndices.delete(projectPath);
}
