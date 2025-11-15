import { Document } from 'flexsearch';
import type { Aim, Phase } from 'shared';

// FlexSearch indices per project
const aimIndices = new Map<string, Document<Aim>>();
const phaseIndices = new Map<string, Document<Phase>>();

// Create or get FlexSearch index for aims
function getAimIndex(projectPath: string): Document<Aim> {
  if (!aimIndices.has(projectPath)) {
    const index = new Document<Aim>({
      document: {
        id: 'id',
        index: ['text']
      },
      tokenize: 'forward',
      context: {
        resolution: 9,
        depth: 3,
        bidirectional: true
      }
    });
    aimIndices.set(projectPath, index);
  }
  return aimIndices.get(projectPath)!;
}

// Create or get FlexSearch index for phases
function getPhaseIndex(projectPath: string): Document<Phase> {
  if (!phaseIndices.has(projectPath)) {
    const index = new Document<Phase>({
      document: {
        id: 'id',
        index: ['name']
      },
      tokenize: 'forward',
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

// Build/rebuild aim index from aims array
export function indexAims(projectPath: string, aims: Aim[]): void {
  const index = getAimIndex(projectPath);

  // Clear existing index
  for (const aim of aims) {
    index.remove(aim.id);
  }

  // Add all aims
  for (const aim of aims) {
    index.add(aim);
  }
}

// Build/rebuild phase index from phases array
export function indexPhases(projectPath: string, phases: Phase[]): void {
  const index = getPhaseIndex(projectPath);

  // Clear existing index
  for (const phase of phases) {
    index.remove(phase.id);
  }

  // Add all phases
  for (const phase of phases) {
    index.add(phase);
  }
}

// Add single aim to index
export function addAimToIndex(projectPath: string, aim: Aim): void {
  const index = getAimIndex(projectPath);
  index.add(aim);
}

// Update aim in index
export function updateAimInIndex(projectPath: string, aim: Aim): void {
  const index = getAimIndex(projectPath);
  index.update(aim);
}

// Remove aim from index
export function removeAimFromIndex(projectPath: string, aimId: string): void {
  const index = getAimIndex(projectPath);
  index.remove(aimId);
}

// Add single phase to index
export function addPhaseToIndex(projectPath: string, phase: Phase): void {
  const index = getPhaseIndex(projectPath);
  index.add(phase);
}

// Update phase in index
export function updatePhaseInIndex(projectPath: string, phase: Phase): void {
  const index = getPhaseIndex(projectPath);
  index.update(phase);
}

// Remove phase from index
export function removePhaseFromIndex(projectPath: string, phaseId: string): void {
  const index = getPhaseIndex(projectPath);
  index.remove(phaseId);
}

// Search aims by text (FlexSearch)
export async function searchAims(projectPath: string, query: string, allAims: Aim[]): Promise<Aim[]> {
  if (!query.trim()) {
    return allAims;
  }

  const index = getAimIndex(projectPath);
  const results = await index.searchAsync(query, { limit: 100 });

  // FlexSearch returns array of results with field name
  const aimIds = new Set<string>();
  for (const result of results) {
    if (Array.isArray(result.result)) {
      result.result.forEach(id => aimIds.add(id as string));
    }
  }

  // Return aims in order of search results
  return allAims.filter(aim => aimIds.has(aim.id));
}

// Search phases by name (FlexSearch)
export async function searchPhases(projectPath: string, query: string, allPhases: Phase[]): Promise<Phase[]> {
  if (!query.trim()) {
    return allPhases;
  }

  const index = getPhaseIndex(projectPath);
  const results = await index.searchAsync(query, { limit: 100 });

  // FlexSearch returns array of results with field name
  const phaseIds = new Set<string>();
  for (const result of results) {
    if (Array.isArray(result.result)) {
      result.result.forEach(id => phaseIds.add(id as string));
    }
  }

  // Return phases in order of search results
  return allPhases.filter(phase => phaseIds.has(phase.id));
}

// Clear indices for a project (e.g., when project is closed)
export function clearIndices(projectPath: string): void {
  aimIndices.delete(projectPath);
  phaseIndices.delete(projectPath);
}

// TODO: Embedding-based search
// - Store embeddings for aim text + description
// - Embed search queries
// - Find similar aims by cosine similarity
// - Combine with FlexSearch results
