import type { Idea } from './types.js';

type PathIdea = Pick<Idea, 'id' | 'text' | 'description' | 'intrinsicValue' | 'supportedIdeas'>;

export type MissionPathStep = {
  id: string;
  text: string;
  description?: string;
  intrinsicValue: number;
  valueInflow: number;
};

const MAX_PATH_DEPTH = 64;
const MAX_PATHS = 100;

/**
 * The missions an idea serves: every distinct root-first chain of parents
 * (pathsToRoot), plus the single chain that follows the strongest value inflow
 * at each branch (pathToRoot). Each step records the value flowing from that
 * parent into the idea below it. Cycles are never reported as roots; hitting
 * a bound sets `truncated`.
 *
 * @param flowValues edge flows from calculateIdeaValues, keyed `${parentId}->${childId}`
 */
export function missionPathsToRoot<T extends PathIdea>(
  ideaMap: Map<string, T>,
  idea: T,
  flowValues: Map<string, number>
): { pathToRoot: MissionPathStep[]; pathsToRoot: MissionPathStep[][]; truncated: boolean } {
  const flow = (parentId: string, childId: string) => flowValues.get(`${parentId}->${childId}`) ?? 0;
  const step = (parent: T, childId: string): MissionPathStep => ({
    id: parent.id,
    text: parent.text,
    description: parent.description,
    intrinsicValue: parent.intrinsicValue ?? 0,
    valueInflow: Number(flow(parent.id, childId).toFixed(4))
  });
  const knownParents = (current: T) => (current.supportedIdeas ?? []).flatMap((id) => ideaMap.get(id) ?? []);

  const pathToRoot: MissionPathStep[] = [];
  const visited = new Set([idea.id]);
  let cursor = idea;
  while (pathToRoot.length < MAX_PATH_DEPTH) {
    const candidates = knownParents(cursor).filter((parent) => !visited.has(parent.id));
    if (candidates.length === 0) break;
    // Ties keep the first parent.
    const best = candidates.reduce((top, next) => (flow(next.id, cursor.id) > flow(top.id, cursor.id) ? next : top));
    pathToRoot.push(step(best, cursor.id));
    visited.add(best.id);
    cursor = best;
  }
  pathToRoot.reverse();

  // A visited set per branch: an ancestor shared by several real paths shows
  // up in each, while a cycle cannot pass for a root.
  const pathsToRoot: MissionPathStep[][] = [];
  let truncated = false;
  const walk = (current: T, upwardPath: MissionPathStep[], branchVisited: Set<string>) => {
    if (pathsToRoot.length >= MAX_PATHS || upwardPath.length >= MAX_PATH_DEPTH) {
      truncated = true;
      return;
    }
    const parents = knownParents(current);
    if (parents.length === 0) {
      pathsToRoot.push([...upwardPath].reverse());
      return;
    }
    for (const parent of parents) {
      if (branchVisited.has(parent.id)) continue;
      walk(parent, [...upwardPath, step(parent, current.id)], new Set([...branchVisited, parent.id]));
    }
  };
  walk(idea, [], new Set([idea.id]));

  return { pathToRoot, pathsToRoot, truncated };
}
