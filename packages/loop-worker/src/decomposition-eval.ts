import { cosineSimilarity, type Idea } from 'shared';

// Offline evaluation of the decompose stage against the graph's own history:
// for implemented parents, hide their real children, let the planner propose,
// and compare proposals with the real children by embedding similarity. A
// shuffled control (proposals scored against another parent's children) is
// the baseline that says whether a similarity number means anything.

export const EVAL_MIN_CHILDREN = 3;
export const EVAL_MAX_CHILDREN = 7;

export function realChildren(parent: Idea, ideaById: Map<string, Idea>): Idea[] {
  return (parent.supportingConnections ?? []).flatMap((connection) => ideaById.get(connection.ideaId) ?? []);
}

/** Implemented parents whose 3-7 children are all implemented, spread evenly over the id order. */
export function selectEvalParents(ideas: Idea[], count: number): Idea[] {
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const eligible = ideas
    .filter((idea) => idea.status.state === 'implemented')
    .filter((idea) => {
      const children = realChildren(idea, ideaById);
      return children.length >= EVAL_MIN_CHILDREN && children.length <= EVAL_MAX_CHILDREN
        && children.every((child) => child.status.state === 'implemented');
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (eligible.length <= count) return eligible;
  return Array.from({ length: count }, (_, index) => eligible[Math.floor((index * eligible.length) / count)]!);
}

/** The graph as the planner would have seen it before the parent was decomposed: open, no children, no outcome comment. */
export function maskChildren(ideaById: Map<string, Idea>, parent: Idea): { masked: Map<string, Idea>; hiddenIds: Set<string> } {
  const hiddenIds = new Set(realChildren(parent, ideaById).map((child) => child.id));
  const masked = new Map(ideaById);
  masked.set(parent.id, { ...parent, supportingConnections: [], status: { ...parent.status, state: 'open', comment: '' } });
  for (const id of hiddenIds) masked.delete(id);
  return { masked, hiddenIds };
}

export type Similarity = {
  /** Per real child: similarity of the closest proposal. */
  bestPerReal: number[];
  meanBest: number;
};

export function compareChildren(realVectors: number[][], proposedVectors: number[][]): Similarity {
  const bestPerReal = realVectors.map((real) => proposedVectors.length === 0
    ? 0
    : Math.max(...proposedVectors.map((proposed) => cosineSimilarity(real, proposed))));
  const meanBest = bestPerReal.length === 0 ? 0 : bestPerReal.reduce((sum, value) => sum + value, 0) / bestPerReal.length;
  return { bestPerReal, meanBest };
}

export function coverage(bestPerReal: number[], threshold: number): number {
  return bestPerReal.length === 0 ? 0 : bestPerReal.filter((value) => value >= threshold).length / bestPerReal.length;
}

/** Text an idea is embedded by: its title plus the start of its description. */
export function embeddingText(idea: Pick<Idea, 'text' | 'description'>): string {
  return `${idea.text}\n${(idea.description ?? '').slice(0, 300)}`.trim();
}
