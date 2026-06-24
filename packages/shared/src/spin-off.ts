import type { Aim } from './types.js';

/**
 * Classification of every aim under a spin-off of one or more selected root aims.
 *
 * Direction: a child *supports* a parent (an aim's `supportingConnections` are
 * its children; its `supportedAims` are its parents). "Contributes to R" means
 * "is a transitive supporter of R", i.e. lives in the sub-graph feeding into R.
 *
 *   copyIds    = roots + every transitive supporter (what goes to the spin-off)
 *   spinOffIds = RED:    copied AND removed from source — the roots plus
 *                        supporters that serve ONLY the selection
 *   overlapIds = ORANGE: copied AND kept in source — shared aims that also
 *                        serve something outside the selection
 *   keptIds    = GREEN:  source-only — not copied (ancestors and unrelated aims)
 *
 * Conservative by construction: an aim is only deleted from source when every
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
  /** Aims to write into the new .bowman: copied, connections restricted to the
   *  copy set (seam edges dropped), phase commitments cleared. */
  spinOffAims: Aim[];
  /** Kept source aims whose edges to removed aims were stripped — rewrite these. */
  sourceAimsToRewrite: Aim[];
  /** Aim ids to delete from source (== plan.spinOffIds). */
  sourceAimIdsToDelete: string[];
}

function childIds(aim: Aim, present: Map<string, Aim>): string[] {
  return (aim.supportingConnections ?? [])
    .map((c) => c.aimId)
    .filter((id) => present.has(id));
}

function parentIds(aim: Aim, present: Map<string, Aim>): string[] {
  return (aim.supportedAims ?? []).filter((id) => present.has(id));
}

/** Classify aims into copy / spin-off / overlap / kept buckets (no aim copying). */
export function planSpinOff(aims: Aim[], rootIds: string[]): SpinOffPlan {
  const byId = new Map(aims.map((a) => [a.id, a]));
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

  // RED = roots, plus any copied aim every parent of which is RED (fixpoint).
  // A parent outside the copy set is never RED, so an aim with an external
  // parent is shared and stays in source (overlap). An aim that serves nothing
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
  const keptIds = aims.map((a) => a.id).filter((id) => !copy.has(id));

  return {
    rootIds: roots,
    copyIds: [...copy],
    spinOffIds: [...red],
    overlapIds,
    keptIds,
  };
}

/** Plan a spin-off and produce the aim objects to write/delete on each side. */
export function computeSpinOff(aims: Aim[], rootIds: string[]): SpinOffResult {
  const plan = planSpinOff(aims, rootIds);
  const byId = new Map(aims.map((a) => [a.id, a]));
  const copySet = new Set(plan.copyIds);
  const redSet = new Set(plan.spinOffIds);

  // Spin-off copies: keep only edges whose other end is also copied (drop seam
  // edges to uncopied ancestors), and clear phase commitments (phases not carried).
  const spinOffAims: Aim[] = plan.copyIds.map((id) => {
    const a = byId.get(id)!;
    return {
      ...a,
      supportedAims: (a.supportedAims ?? []).filter((p) => copySet.has(p)),
      supportingConnections: (a.supportingConnections ?? []).filter((c) => copySet.has(c.aimId)),
      incoming: a.incoming ? a.incoming.filter((p) => copySet.has(p)) : a.incoming,
      committedIn: [],
    };
  });

  // Source rewrites: drop edges from kept aims to removed (RED) aims.
  const sourceAimsToRewrite: Aim[] = [];
  for (const a of aims) {
    if (redSet.has(a.id)) continue; // deleted, no rewrite
    const supported = a.supportedAims ?? [];
    const conns = a.supportingConnections ?? [];
    const incoming = a.incoming ?? [];
    const newSupported = supported.filter((p) => !redSet.has(p));
    const newConns = conns.filter((c) => !redSet.has(c.aimId));
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
