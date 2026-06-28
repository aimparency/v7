import type { Aim } from 'shared';
import { cosineSimilarity } from 'shared';

// Pure core of the duplicate-detection maintenance tooling, shared by
// project.findDuplicates (ranked pair report) and project.graphHygiene
// (union-find clusters). Kept dependency-free (inject vectors + aimMap) so the
// precision behaviour — especially the parent-child exclusion — is unit-testable
// without disk, embeddings, or a tRPC caller.

/**
 * A high-cosine parent<->child pair is almost always an intentional
 * summary/detail split, not an accidental duplicate to merge. Both the duplicate
 * report and the hygiene clusters exclude these; collapsing a *finished* nesting
 * is surfaced separately (merge_aims + graph_hygiene's collapseCandidates).
 * Adjacency is checked from x's side via either link array (the graph keeps both
 * directions consistent, so one side suffices).
 */
export function isDirectParentChild(aimMap: Map<string, Aim>, x: string, y: string): boolean {
  const ax = aimMap.get(x);
  if (!ax) return false;
  return (ax.supportedAims ?? []).includes(y)
    || (ax.supportingConnections ?? []).some((c: any) => c.aimId === y);
}

export interface DuplicatePair { aId: string; bId: string; score: number; }

/**
 * All-pairs cosine over the given (id, vector) list, returning the pairs at or
 * above `threshold` — excluding direct parent-child pairs — sorted by score
 * descending. O(n²/2); negligible at graph scale.
 */
export function findDuplicatePairs(
  indexed: Array<{ id: string; vector: number[] }>,
  aimMap: Map<string, Aim>,
  threshold: number,
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < indexed.length; i++) {
    const a = indexed[i]!;
    for (let j = i + 1; j < indexed.length; j++) {
      const b = indexed[j]!;
      if (a.vector.length !== b.vector.length) continue;
      const score = cosineSimilarity(a.vector, b.vector);
      if (score >= threshold && !isDirectParentChild(aimMap, a.id, b.id)) {
        pairs.push({ aId: a.id, bId: b.id, score });
      }
    }
  }
  pairs.sort((p, q) => q.score - p.score);
  return pairs;
}

/**
 * Group ids into near-duplicate clusters via union-find: two ids are linked when
 * their vectors are at/above `threshold` and they are not a direct parent-child
 * pair. Returns clusters of size >= 2, largest first.
 */
export function clusterDuplicates(
  indexedIds: string[],
  vectorOf: (id: string) => number[] | undefined,
  aimMap: Map<string, Aim>,
  threshold: number,
): string[][] {
  const uf = new Map<string, string>(indexedIds.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (uf.get(r) !== r) r = uf.get(r)!;
    while (uf.get(x) !== r) { const nx = uf.get(x)!; uf.set(x, r); x = nx; }
    return r;
  };
  for (let i = 0; i < indexedIds.length; i++) {
    const vi = vectorOf(indexedIds[i]!);
    if (!vi) continue;
    for (let j = i + 1; j < indexedIds.length; j++) {
      const vj = vectorOf(indexedIds[j]!);
      if (!vj || vi.length !== vj.length) continue;
      if (cosineSimilarity(vi, vj) >= threshold
          && !isDirectParentChild(aimMap, indexedIds[i]!, indexedIds[j]!)) {
        const ri = find(indexedIds[i]!), rj = find(indexedIds[j]!);
        if (ri !== rj) uf.set(ri, rj);
      }
    }
  }
  const clusterMap = new Map<string, string[]>();
  for (const id of indexedIds) {
    const r = find(id);
    (clusterMap.get(r) ?? clusterMap.set(r, []).get(r)!).push(id);
  }
  return [...clusterMap.values()]
    .filter((c) => c.length > 1)
    .sort((a, b) => b.length - a.length);
}
