import type { Idea } from './types.js';
import { calculateAimValues } from './value-calculation.js';

/**
 * Classification of every idea under a spin-off of one or more selected root ideas.
 *
 * Direction: a child *supports* a parent (an idea's `supportingConnections` are
 * its children; its `supportedAims` are its parents). "Contributes to R" means
 * "is a transitive supporter of R", i.e. lives in the sub-graph feeding into R.
 *
 *   copyIds    = roots + every transitive supporter (what goes to the spin-off)
 *   spinOffIds = RED:    copied AND removed from source — the roots plus
 *                        supporters that serve ONLY the selection
 *   overlapIds = ORANGE: copied AND kept in source — shared ideas that also
 *                        serve something outside the selection
 *   keptIds    = GREEN:  source-only — not copied (ancestors and unrelated ideas)
 *
 * Conservative by construction: an idea is only deleted from source when every
 * goal it serves is itself being removed, so nothing shared is ever lost.
 */
export interface SpinOffPlan {
  rootIds: string[];
  copyIds: string[];
  spinOffIds: string[];
  overlapIds: string[];
  keptIds: string[];
}

export interface SpinOffResult {
  plan: SpinOffPlan;
  /** Ideas to write into the new .bowman: copied, connections restricted to the
   *  copy set (seam edges dropped), phase commitments cleared. */
  spinOffAims: Idea[];
  /** Kept source ideas whose edges to removed ideas were stripped — rewrite these. */
  sourceAimsToRewrite: Idea[];
  /** Idea ids to delete from source (== plan.spinOffIds). */
  sourceAimIdsToDelete: string[];
}

export interface RemappedSpinOff {
  ideas: Idea[];
  /** Only entries whose original id collided with an existing target id. */
  idMap: Record<string, string>;
}

/**
 * Make a copied branch safe to insert into an existing graph.
 *
 * Existing target ideas are never changed. Colliding ids are replaced throughout
 * the copied branch, while its internal contribution structure is preserved.
 * The copied roots are already free-floating because computeSpinOff drops seam
 * edges to ideas outside the branch.
 */
export function remapSpinOffCollisions(
  ideas: Idea[],
  occupiedIds: Iterable<string>,
  createId: () => string,
): RemappedSpinOff {
  const occupied = new Set(occupiedIds);
  const unavailable = new Set(occupied);
  for (const idea of ideas) unavailable.add(idea.id);

  const idMap: Record<string, string> = {};
  for (const idea of ideas) {
    if (!occupied.has(idea.id)) continue;
    let replacement = createId();
    while (unavailable.has(replacement)) replacement = createId();
    idMap[idea.id] = replacement;
    unavailable.add(replacement);
  }

  const mapId = (id: string) => idMap[id] ?? id;
  return {
    idMap,
    ideas: ideas.map((idea) => ({
      ...idea,
      id: mapId(idea.id),
      supportedAims: (idea.supportedAims ?? []).map(mapId),
      supportingConnections: (idea.supportingConnections ?? []).map((connection) => ({
        ...connection,
        ideaId: mapId(connection.ideaId),
      })),
      ...(idea.incoming ? { incoming: idea.incoming.map(mapId) } : {}),
      committedIn: [],
    })),
  };
}

function childIds(idea: Idea, present: Map<string, Idea>): string[] {
  return (idea.supportingConnections ?? [])
    .map((c) => c.ideaId)
    .filter((id) => present.has(id));
}

function parentIds(idea: Idea, present: Map<string, Idea>): string[] {
  return (idea.supportedAims ?? []).filter((id) => present.has(id));
}

/** Classify ideas into copy / spin-off / overlap / kept buckets (no idea copying). */
export function planSpinOff(ideas: Idea[], rootIds: string[]): SpinOffPlan {
  const byId = new Map(ideas.map((a) => [a.id, a]));
  const roots = rootIds.filter((id) => byId.has(id));

  // copy = roots + all transitive supporters (descendants down supportingConnections)
  const copy = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (copy.has(id)) continue;
    copy.add(id);
    for (const childId of childIds(byId.get(id)!, byId)) {
      if (!copy.has(childId)) stack.push(childId);
    }
  }

  // RED = roots, plus any copied idea every parent of which is RED (fixpoint).
  // A parent outside the copy set is never RED, so an idea with an external
  // parent is shared and stays in source (overlap). An idea that serves nothing
  // (no in-set parents) only reached the copy set via the selection → RED.
  const red = new Set<string>(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of copy) {
      if (red.has(id)) continue;
      const parents = parentIds(byId.get(id)!, byId);
      const allParentsRed = parents.length > 0 && parents.every((p) => red.has(p));
      if (allParentsRed || parents.length === 0) {
        red.add(id);
        changed = true;
      }
    }
  }

  const overlapIds = [...copy].filter((id) => !red.has(id));
  const keptIds = ideas.map((a) => a.id).filter((id) => !copy.has(id));

  return {
    rootIds: roots,
    copyIds: [...copy],
    spinOffIds: [...red],
    overlapIds,
    keptIds,
  };
}

export interface SpinOffOptions {
  /** Compensate for the inflow that copied ideas used to receive from non-copied
   *  parents (the dropped seam edges) by folding that lost flow into their
   *  intrinsicValue, so the relative weighting of the exported sub-graph survives
   *  the cut. Defaults off; the value model is only consulted when enabled. */
  preserveInflow?: boolean;
}

/**
 * For each copied idea, the value that flowed into it from parents *outside* the
 * copy set in the original graph. Dropping those seam edges would otherwise
 * silently zero this contribution in the isolated spin-off.
 */
function externalInflowByAim(ideas: Idea[], copySet: Set<string>, byId: Map<string, Idea>): Map<string, number> {
  const inflow = new Map<string, number>();
  const { flowValues, totalIntrinsic } = calculateAimValues(ideas);
  if (totalIntrinsic <= 0) return inflow; // no value signal to preserve

  for (const id of copySet) {
    const a = byId.get(id);
    if (!a) continue;
    let lost = 0;
    for (const parentId of a.supportedAims ?? []) {
      if (copySet.has(parentId)) continue; // internal edge: recomputed in the new graph
      // flowValues are normalized (sum to 1); scale back to intrinsic units.
      lost += (flowValues.get(`${parentId}->${id}`) ?? 0) * totalIntrinsic;
    }
    if (lost > 0) inflow.set(id, lost);
  }
  return inflow;
}

/** Plan a spin-off and produce the idea objects to write/delete on each side. */
export function computeSpinOff(ideas: Idea[], rootIds: string[], options: SpinOffOptions = {}): SpinOffResult {
  const plan = planSpinOff(ideas, rootIds);
  const byId = new Map(ideas.map((a) => [a.id, a]));
  const copySet = new Set(plan.copyIds);
  const redSet = new Set(plan.spinOffIds);

  const inflow = options.preserveInflow
    ? externalInflowByAim(ideas, copySet, byId)
    : new Map<string, number>();

  // Spin-off copies: keep only edges whose other end is also copied (drop seam
  // edges to uncopied ancestors), and clear phase commitments (phases not carried).
  // When preserving inflow, fold each idea's lost external inflow into intrinsicValue.
  const spinOffAims: Idea[] = plan.copyIds.map((id) => {
    const a = byId.get(id)!;
    const extraIntrinsic = inflow.get(id) ?? 0;
    return {
      ...a,
      ...(extraIntrinsic > 0 ? { intrinsicValue: (a.intrinsicValue ?? 0) + extraIntrinsic } : {}),
      supportedAims: (a.supportedAims ?? []).filter((p) => copySet.has(p)),
      supportingConnections: (a.supportingConnections ?? []).filter((c) => copySet.has(c.ideaId)),
      incoming: a.incoming ? a.incoming.filter((p) => copySet.has(p)) : a.incoming,
      committedIn: [],
    };
  });

  // Source rewrites: drop edges from kept ideas to removed (RED) ideas.
  const sourceAimsToRewrite: Idea[] = [];
  for (const a of ideas) {
    if (redSet.has(a.id)) continue; // deleted, no rewrite
    const supported = a.supportedAims ?? [];
    const conns = a.supportingConnections ?? [];
    const incoming = a.incoming ?? [];
    const newSupported = supported.filter((p) => !redSet.has(p));
    const newConns = conns.filter((c) => !redSet.has(c.ideaId));
    const newIncoming = incoming.filter((p) => !redSet.has(p));
    if (
      newSupported.length !== supported.length ||
      newConns.length !== conns.length ||
      newIncoming.length !== incoming.length
    ) {
      sourceAimsToRewrite.push({
        ...a,
        supportedAims: newSupported,
        supportingConnections: newConns,
        ...(a.incoming ? { incoming: newIncoming } : {}),
      });
    }
  }

  return {
    plan,
    spinOffAims,
    sourceAimsToRewrite,
    sourceAimIdsToDelete: plan.spinOffIds,
  };
}
