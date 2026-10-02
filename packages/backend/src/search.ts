import { Document } from 'flexsearch';
import Fuse from 'fuse.js';
import type { Idea, Phase, SearchAimResult } from 'shared';
import { normalizeProjectPath } from './project-path.js';

// FlexSearch indices per project
const ideaIndices = new Map<string, Document<Idea>>();
const phaseIndices = new Map<string, Document<Phase>>();
type IdeaIdPrefixIndex = {
  ideaIds: Set<string>;
  children: Map<string, IdeaIdPrefixIndex>;
};

const ideaIdPrefixIndices = new Map<string, IdeaIdPrefixIndex>();

function createAimIdPrefixIndex(): IdeaIdPrefixIndex {
  return {
    ideaIds: new Set<string>(),
    children: new Map<string, IdeaIdPrefixIndex>()
  };
}

// ... existing getAimIndex ...
function getAimIndex(rawProjectPath: string): Document<Idea> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  if (!ideaIndices.has(projectPath)) {
    const index = new Document<Idea>({
      document: {
        id: 'id',
        index: ['text', 'status.state'] as any
      },
      tokenize: 'full',
      cache: true
    });
    ideaIndices.set(projectPath, index);
  }
  return ideaIndices.get(projectPath)!;
}

function getAimIdPrefixIndex(rawProjectPath: string): IdeaIdPrefixIndex {
  const projectPath = normalizeProjectPath(rawProjectPath);
  if (!ideaIdPrefixIndices.has(projectPath)) {
    ideaIdPrefixIndices.set(projectPath, createAimIdPrefixIndex());
  }
  return ideaIdPrefixIndices.get(projectPath)!;
}

function addAimIdToPrefixIndex(projectPath: string, ideaId: string): void {
  const normalizedId = ideaId.toLowerCase();
  let node = getAimIdPrefixIndex(projectPath);

  for (const char of normalizedId) {
    let child = node.children.get(char);
    if (!child) {
      child = createAimIdPrefixIndex();
      node.children.set(char, child);
    }
    child.ideaIds.add(ideaId);
    node = child;
  }
}

function removeAimIdFromPrefixIndex(projectPath: string, ideaId: string): void {
  const normalizedId = ideaId.toLowerCase();
  const root = getAimIdPrefixIndex(projectPath);
  const path: Array<{ parent: IdeaIdPrefixIndex; char: string; node: IdeaIdPrefixIndex }> = [];
  let node = root;

  for (const char of normalizedId) {
    const child = node.children.get(char);
    if (!child) return;
    path.push({ parent: node, char, node: child });
    node = child;
  }

  for (let i = path.length - 1; i >= 0; i--) {
    const entry = path[i]!;
    entry.node.ideaIds.delete(ideaId);
    if (entry.node.ideaIds.size === 0 && entry.node.children.size === 0) {
      entry.parent.children.delete(entry.char);
    }
  }
}

function searchAimIdsByPrefix(projectPath: string, query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 8) return [];

  let node = getAimIdPrefixIndex(projectPath);
  for (const char of normalizedQuery) {
    const child = node.children.get(char);
    if (!child) return [];
    node = child;
  }

  return Array.from(node.ideaIds);
}

// ... existing getPhaseIndex ...
function getPhaseIndex(rawProjectPath: string): Document<Phase> {
  const projectPath = normalizeProjectPath(rawProjectPath);
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
export function indexAims(projectPath: string, ideas: Idea[]): void {
  const index = getAimIndex(projectPath);
  for (const idea of ideas) index.remove(idea.id);
  for (const idea of ideas) index.add(idea);

  ideaIdPrefixIndices.set(normalizeProjectPath(projectPath), createAimIdPrefixIndex());
  for (const idea of ideas) addAimIdToPrefixIndex(projectPath, idea.id);
}

export function indexPhases(projectPath: string, phases: Phase[]): void {
  const index = getPhaseIndex(projectPath);
  for (const phase of phases) index.remove(phase.id);
  for (const phase of phases) index.add(phase);
}

export function addAimToIndex(projectPath: string, idea: Idea): void {
  const index = getAimIndex(projectPath);
  index.add(idea);
  addAimIdToPrefixIndex(projectPath, idea.id);
}

export function updateAimInIndex(projectPath: string, idea: Idea): void {
  const index = getAimIndex(projectPath);
  index.update(idea);
  removeAimIdFromPrefixIndex(projectPath, idea.id);
  addAimIdToPrefixIndex(projectPath, idea.id);
}

export function removeAimFromIndex(projectPath: string, ideaId: string): void {
  const index = getAimIndex(projectPath);
  index.remove(ideaId);
  removeAimIdFromPrefixIndex(projectPath, ideaId);
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

// Search ideas by text (FlexSearch)
export async function searchAims(projectPath: string, query: string, allAims: Idea[]): Promise<SearchAimResult[]> {
  if (!query.trim()) {
    return []; // Return empty if no query, consistent with search behavior
  }

  const index = getAimIndex(projectPath);
  const results = await index.searchAsync(query, { limit: 100 });
  const normalizedQuery = query.trim().toLowerCase();

  // FlexSearch returns array of results with field name
  const ideaIds = new Set<string>();
  const scores = new Map<string, number>();

  // Aggregate results and assign scores based on rank
  let rank = 0;
  for (const result of results) {
    if (Array.isArray(result.result)) {
      result.result.forEach(id => {
        const ideaId = id as string;
        if (!ideaIds.has(ideaId)) {
          ideaIds.add(ideaId);
          // Synthetic score: 1.0 for top result, decaying by 0.05
          scores.set(ideaId, Math.max(0.1, 1.0 - (rank * 0.05)));
          rank++;
        }
      });
    }
  }

  const ideasById = new Map(allAims.map(idea => [idea.id, idea]));
  const idMatches = searchAimIdsByPrefix(projectPath, query)
    .map(ideaId => ideasById.get(ideaId))
    .filter((idea): idea is Idea => Boolean(idea))
    .map(idea => ({
      ...idea,
      score: 2 + (normalizedQuery.length / 100),
      idMatch: { prefix: idea.id.slice(0, normalizedQuery.length) }
    }));

  // Return ideas in order of search results with scores
  return [
    ...idMatches,
    ...allAims
    .filter(idea => ideaIds.has(idea.id))
    .map(idea => ({
      ...idea,
      score: scores.get(idea.id)
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
  ];
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
export function clearIndices(rawProjectPath: string): void {
  const projectPath = normalizeProjectPath(rawProjectPath);
  ideaIndices.delete(projectPath);
  phaseIndices.delete(projectPath);
  ideaIdPrefixIndices.delete(projectPath);
}
