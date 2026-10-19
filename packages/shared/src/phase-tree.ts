// Whether `phaseId` lies in the subtree of `subtreeRootId`, the root included.
// Such a phase can't become the root's parent: the tree would get a cycle.
// Walks the parent links up and stops on a loop already in the data.
export function isInPhaseSubtree(
  phaseId: string,
  subtreeRootId: string,
  parentOf: (phaseId: string) => string | null | undefined
): boolean {
  const visited = new Set<string>();
  for (let current: string | null | undefined = phaseId; current && !visited.has(current); current = parentOf(current)) {
    if (current === subtreeRootId) return true;
    visited.add(current);
  }
  return false;
}
