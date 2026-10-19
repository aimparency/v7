import { Document } from 'flexsearch';
import Fuse from 'fuse.js';
import type { Idea, Phase, SearchIdeaResult } from 'shared';
import { normalizeProjectPath } from './project-path.js';
import { phaseTreeDistances } from './phase-tree-distance.js';

// FlexSearch indices per project
const ideaIndices = new Map<string, Document<Idea>>();
const phaseIndices = new Map<string, Document<Phase>>();
type IdeaIdPrefixIndex = {
  ideaIds: Set<string>;
  children: Map<string, IdeaIdPrefixIndex>;
};

const ideaIdPrefixIndices = new Map<string, IdeaIdPrefixIndex>();

function createIdeaIdPrefixIndex(): IdeaIdPrefixIndex {
  return {
    ideaIds: new Set<string>(),
    children: new Map<string, IdeaIdPrefixIndex>()
  };
}

// ... existing getIdeaIndex ...
function getIdeaIndex(rawProjectPath: string): Document<Idea> {
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

function getIdeaIdPrefixIndex(rawProjectPath: string): IdeaIdPrefixIndex {
  const projectPath = normalizeProjectPath(rawProjectPath);
  if (!ideaIdPrefixIndices.has(projectPath)) {
    ideaIdPrefixIndices.set(projectPath, createIdeaIdPrefixIndex());
  }
  return ideaIdPrefixIndices.get(projectPath)!;
}

function addIdeaIdToPrefixIndex(projectPath: string, ideaId: string): void {
  const normalizedId = ideaId.toLowerCase();
  let node = getIdeaIdPrefixIndex(projectPath);

  for (const char of normalizedId) {
    let child = node.children.get(char);
    if (!child) {
      child = createIdeaIdPrefixIndex();
      node.children.set(char, child);
    }
    child.ideaIds.add(ideaId);
    node = child;
  }
}

function removeIdeaIdFromPrefixIndex(projectPath: string, ideaId: string): void {
  const normalizedId = ideaId.toLowerCase();
  const root = getIdeaIdPrefixIndex(projectPath);
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

function searchIdeaIdsByPrefix(projectPath: string, query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 8) return [];

  let node = getIdeaIdPrefixIndex(projectPath);
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
export function indexIdeas(projectPath: string, ideas: Idea[]): void {
  const index = getIdeaIndex(projectPath);
  for (const idea of ideas) index.remove(idea.id);
  for (const idea of ideas) index.add(idea);

  ideaIdPrefixIndices.set(normalizeProjectPath(projectPath), createIdeaIdPrefixIndex());
  for (const idea of ideas) addIdeaIdToPrefixIndex(projectPath, idea.id);
}

export function indexPhases(projectPath: string, phases: Phase[]): void {
  const index = getPhaseIndex(projectPath);
  for (const phase of phases) index.remove(phase.id);
  for (const phase of phases) index.add(phase);
}

export function addIdeaToIndex(projectPath: string, idea: Idea): void {
  const index = getIdeaIndex(projectPath);
  index.add(idea);
  addIdeaIdToPrefixIndex(projectPath, idea.id);
}

export function updateIdeaInIndex(projectPath: string, idea: Idea): void {
  const index = getIdeaIndex(projectPath);
  index.update(idea);
  removeIdeaIdFromPrefixIndex(projectPath, idea.id);
  addIdeaIdToPrefixIndex(projectPath, idea.id);
}

export function removeIdeaFromIndex(projectPath: string, ideaId: string): void {
  const index = getIdeaIndex(projectPath);
  index.remove(ideaId);
  removeIdeaIdFromPrefixIndex(projectPath, ideaId);
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
export async function searchIdeas(projectPath: string, query: string, allIdeas: Idea[]): Promise<SearchIdeaResult[]> {
  if (!query.trim()) {
    return []; // Return empty if no query, consistent with search behavior
  }

  const index = getIdeaIndex(projectPath);
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

  const ideasById = new Map(allIdeas.map(idea => [idea.id, idea]));
  const idMatches = searchIdeaIdsByPrefix(projectPath, query)
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
    ...allIdeas
    .filter(idea => ideaIds.has(idea.id))
    .map(idea => ({
      ...idea,
      score: scores.get(idea.id)
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
  ];
}

// Search phases by name (Fuzzy search using Fuse.js)
// Fuse scores run from 0 (exact) to the 0.4 threshold; a different word or
// digit costs about 0.25, a longer name with the same start about 0.01.
// Tree distance adds at most TREE_DISTANCE_WEIGHT: it decides between equally
// good text matches without lifting a worse match over a better one.
const TREE_DISTANCE_WEIGHT = 0.1;
const treeDistancePenalty = (steps: number) =>
  steps === Infinity ? TREE_DISTANCE_WEIGHT : TREE_DISTANCE_WEIGHT * steps / (steps + 3);

// Phases matching `query` (all for an empty one), best first. With `near`,
// phases closer in the tree to `near.fromPhaseId` rank higher.
export function searchPhases(
  query: string,
  candidates: Phase[],
  near?: { fromPhaseId: string | null, phases: Phase[], rootPhaseIds: string[] }
): Phase[] {
  const scored = query.trim()
    ? new Fuse(candidates, {
        keys: ['name'],
        threshold: 0.4, // 0.0 = exact match, 1.0 = match anything
        distance: 100,  // Maximum distance for fuzzy match
        minMatchCharLength: 1,
        includeScore: true,
        ignoreLocation: true, // Don't prioritize matches at start
        findAllMatches: true
      }).search(query).map((result) => ({ phase: result.item, score: result.score ?? 0 }))
    : candidates.map((phase) => ({ phase, score: 0 }));

  if (near) {
    const distance = phaseTreeDistances(near.fromPhaseId, Object.fromEntries(near.phases.map((phase) => [phase.id, phase])), near.rootPhaseIds);
    for (const entry of scored) entry.score += treeDistancePenalty(distance(entry.phase.id));
    scored.sort((a, b) => a.score - b.score);
  }
  return scored.map((entry) => entry.phase);
}

// Clear indices for a project (e.g., when project is closed)
export function clearIndices(rawProjectPath: string): void {
  const projectPath = normalizeProjectPath(rawProjectPath);
  ideaIndices.delete(projectPath);
  phaseIndices.delete(projectPath);
  ideaIdPrefixIndices.delete(projectPath);
}
