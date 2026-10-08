import type { Idea } from './types.js';
import { ANNUAL_DISCOUNT_RATE } from './constants.js';

export function discountValue(
  estimatedValue: number,
  durationDays: number,
  annualDiscountRate = ANNUAL_DISCOUNT_RATE
): number {
  if (!Number.isFinite(estimatedValue) || estimatedValue < 0) {
    throw new Error('Estimated value must be a finite, non-negative number');
  }
  if (!Number.isFinite(durationDays) || durationDays < 0) {
    throw new Error('Duration must be a finite number greater than or equal to 0 days');
  }
  if (!Number.isFinite(annualDiscountRate) || annualDiscountRate <= -1) {
    throw new Error('Annual discount rate must be finite and greater than -1');
  }
  return estimatedValue / Math.pow(1 + annualDiscountRate, durationDays / 365);
}

export function calculateProfitabilityIndex(
  discountedEstimatedValue: number,
  estimatedPresentCost: number
): number {
  if (!Number.isFinite(discountedEstimatedValue) || discountedEstimatedValue < 0) {
    throw new Error('Discounted estimated value must be finite and non-negative');
  }
  if (!Number.isFinite(estimatedPresentCost) || estimatedPresentCost <= 0) {
    throw new Error('Estimated present cost must be a finite number greater than 0');
  }
  return discountedEstimatedValue / estimatedPresentCost;
}

function validateEconomicInputs(ideas: Idea[]): void {
  for (const idea of ideas) {
    if (!Number.isFinite(idea.cost) || idea.cost <= 0) {
      throw new Error(`Idea "${idea.id}" has invalid cost: estimated direct cost must be a finite number greater than 0`);
    }
    const duration = idea.duration ?? 1;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(`Idea "${idea.id}" has invalid duration: days until return must be a finite number greater than or equal to 0`);
    }
    const intrinsicValue = idea.intrinsicValue ?? 0;
    if (!Number.isFinite(intrinsicValue) || intrinsicValue < 0) {
      throw new Error(`Idea "${idea.id}" has invalid intrinsic value: estimated direct value must be finite and non-negative`);
    }
  }
}

// Repo-level cross-repo links: a local idea's supportingRepos edge points at a
// WHOLE external repo (by repoId, no ideaId — see RepoConnectionSchema). For
// value flow we model each referenced repo as ONE zero-intrinsic LEAF SINK node
// (its id IS the repoId) and turn every repo edge into an ordinary
// supportingConnection into that node, so the existing flow machinery handles it
// on a single code path. A leaf retains all inflow (effectiveLoopWeight 1), so
// flow is EXPORTED out of the local graph into the sink; totalIntrinsic is
// unchanged (repo nodes carry intrinsic 0) and local ideas' retained values
// shrink by exactly the exported flow (value is conserved flow, not aggregate).
export function expandRepoSinkNodes(ideas: Idea[]): Idea[] {
  // Fast path: no repo edges ⇒ nothing to merge, return the array untouched.
  if (!ideas.some(a => a.supportingRepos && a.supportingRepos.length > 0)) {
    return ideas;
  }

  const localIds = new Set(ideas.map(a => a.id));
  const repoIds = new Set<string>();
  const expanded: Idea[] = [];

  for (const idea of ideas) {
    if (idea.supportingRepos && idea.supportingRepos.length > 0) {
      // Clone (don't mutate the caller's idea) and fold each repo edge into
      // supportingConnections, targeting the repo node whose id is the repoId.
      const repoConnections = idea.supportingRepos.map(r => {
        repoIds.add(r.repoId);
        return {
          ideaId: r.repoId,
          weight: r.weight ?? 1,
          relativePosition: (r.relativePosition ?? [0, 0]) as [number, number]
        };
      });
      expanded.push({
        ...idea,
        supportingConnections: [...(idea.supportingConnections ?? []), ...repoConnections]
      });
    } else {
      expanded.push(idea);
    }
  }

  // One leaf sink node per referenced repo. Skip a repoId that collides with a
  // real local idea id (already a node — don't shadow it).
  for (const repoId of repoIds) {
    if (!localIds.has(repoId)) {
      expanded.push(makeRepoSinkNode(repoId));
    }
  }

  return expanded;
}

function makeRepoSinkNode(repoId: string): Idea {
  return {
    id: repoId,
    text: `repo:${repoId}`,
    intrinsicValue: 0, // carries no intrinsic ⇒ keeps totalIntrinsic = local intrinsics
    cost: 0,           // the external repo's cost is not ours to aggregate
    duration: 1,
    costVariance: 0,
    valueVariance: 0,
    reflections: [],
    status: { state: 'open', comment: '', date: 0 },
    supportingConnections: [], // leaf ⇒ retains all inflow (the sink)
    supportingRepos: [],
    supportedIdeas: [],
    committedIn: [],
    tags: [],
    loopWeight: 0,
    archived: false
  } as Idea;
}

export function calculateIdeaValues(inputIdeas: Idea[]): {
  values: Map<string, number>, 
  totalIntrinsic: number, 
  flowShares: Map<string, number>,
  flowValues: Map<string, number>,
  attributionShares: Map<string, number>,
  costs: Map<string, number>,
  doneCosts: Map<string, number>,
  priorities: Map<string, number>
} {
  validateEconomicInputs(inputIdeas);
  // Merge repo-link edges into zero-intrinsic leaf sink nodes before any
  // topology is built, so cross-repo flow runs on the same single code path.
  const ideas = expandRepoSinkNodes(inputIdeas);

  const ideaMap = new Map<string, Idea>();
  const currentValues = new Map<string, number>();
  const flowShares = new Map<string, number>();
  const flowValues = new Map<string, number>();
  let totalIntrinsic = 0;

  // 1. Initialize and Pre-calculate Topology
  // Map<ParentID, List<{TargetID, Share}>>
  const flowMatrix = new Map<string, { target: string, share: number }[]>();

  for (const idea of ideas) {
    ideaMap.set(idea.id, idea);
    totalIntrinsic += (idea.intrinsicValue ?? 0);
  }

  for (const parent of ideas) {
    // Determine weights
    const rawLoopWeight = parent.loopWeight ?? 0; // schema default is 0 (pure pass-through)
    
    // Only count children that actually exist in the ideaMap (prevent leaks)
    const validConnections = parent.supportingConnections?.filter(c => ideaMap.has(c.ideaId)) || [];
    const childrenWeightSum = validConnections.reduce((sum, c) => sum + (c.weight || 1), 0);
    
    let totalWeight = rawLoopWeight + childrenWeightSum;
    
    // Leaf Retention Logic: If no outgoing flow (children=0) and loop is 0,
    // force effective loop to 1 to prevent value destruction at leafs.
    let effectiveLoopWeight = rawLoopWeight;
    if (totalWeight === 0) {
        totalWeight = 1;
        effectiveLoopWeight = 1;
    }

    const distributions: { target: string, share: number }[] = [];

    // Loop Flow (Self-Retention)
    if (effectiveLoopWeight > 0) {
        const share = effectiveLoopWeight / totalWeight;
        if (share > 0) {
            distributions.push({ target: parent.id, share });
        }
    }

    // Children Flow
    for (const conn of validConnections) {
        const share = (conn.weight || 1) / totalWeight;
        if (share > 0) {
            distributions.push({ target: conn.ideaId, share });
            // Store for UI visualization
            flowShares.set(`${parent.id}->${conn.ideaId}`, share);
        }
    }
    
    flowMatrix.set(parent.id, distributions);
  }

  // 2. Initialize Values
  for (const idea of ideas) {
    const intrinsic = idea.intrinsicValue ?? 0;
    currentValues.set(idea.id, totalIntrinsic > 0 ? intrinsic / totalIntrinsic : 0);
  }

  if (totalIntrinsic === 0) {
    const attributionShares = calculateAttributionShares(ideas, ideaMap, flowValues, totalIntrinsic);
    const costs = distributeCostsStable(ideas, ideaMap, attributionShares, false);
    const doneCosts = distributeCostsStable(ideas, ideaMap, attributionShares, true, costs);
    const priorities = new Map(ideas.map(idea => [idea.id, 0]));
    return { values: currentValues, totalIntrinsic: 0, flowShares, flowValues, attributionShares, costs, doneCosts, priorities };
  }

  // 3. Iterate
  const iterations = 100;
  // Epsilon for normalized values. Average is 1/N. 
  // Use 0.001 relative to average value for high precision.
  const epsilon = 0.001 * (1.0 / (ideas.length || 1)); 
  // console.log(`[ValueCalc] Starting calculation. Nodes: ${ideas.length}. Threshold: ${epsilon.toExponential(2)}`);

  for (let iter = 0; iter < iterations; iter++) {
    const nextValues = new Map<string, number>();

    // A. Add Intrinsic (Inflow)
    for (const idea of ideas) {
      nextValues.set(idea.id, (idea.intrinsicValue ?? 0) / totalIntrinsic);
    }

    // B. Distribute Flow from Previous Step
    for (const parent of ideas) {
        const parentValue = currentValues.get(parent.id) || 0;
        const distributions = flowMatrix.get(parent.id) || [];
        
        for (const dist of distributions) {
            const flow = parentValue * dist.share;
            nextValues.set(dist.target, (nextValues.get(dist.target) || 0) + flow);
        }
    }

    // C. Normalize
    let currentSum = 0;
    for (const val of nextValues.values()) {
      currentSum += val;
    }

    if (currentSum > 0) {
      const scale = 1.0 / currentSum;
      for (const [id, val] of nextValues) {
        nextValues.set(id, val * scale);
      }
    }

    // D. Check Convergence
    let maxChange = 0;
    for (const idea of ideas) {
      const oldV = currentValues.get(idea.id) || 0;
      const newV = nextValues.get(idea.id) || 0;
      maxChange = Math.max(maxChange, Math.abs(newV - oldV));
    }

    // Update
    for (const [id, val] of nextValues) {
      currentValues.set(id, val);
    }

    if (maxChange < epsilon) {
      // console.log(`[ValueCalc] Converged in ${iter + 1} iterations. Max Change: ${maxChange.toExponential(2)}`);
      break;
    } else if (iter === iterations - 1) {
      // console.warn(`[ValueCalc] Reached max iterations (${iterations}). Final Max Change: ${maxChange.toExponential(2)}`);
    }
  }

  // 4. Calculate Final Flow Values
  for (const parent of ideas) {
      const parentValue = currentValues.get(parent.id) || 0;
      const distributions = flowMatrix.get(parent.id) || [];
      for (const dist of distributions) {
          flowValues.set(`${parent.id}->${dist.target}`, parentValue * dist.share);
      }
  }

  // Each parent carries the share of a child's cost that matches its share of the child's value.
  const attributionShares = calculateAttributionShares(ideas, ideaMap, flowValues, totalIntrinsic);
  const costs = distributeCostsStable(ideas, ideaMap, attributionShares, false);
  const doneCosts = distributeCostsStable(ideas, ideaMap, attributionShares, true, costs);

  // Priority is the positive profitability ratio: discounted estimated
  // flowed value divided by estimated present attributed cost. Variance fields
  // remain persisted for compatibility but are informational in this model.
  const priorities = new Map<string, number>();
  for (const idea of ideas) {
      const estimatedValue = (currentValues.get(idea.id) ?? 0) * totalIntrinsic;
      const cost = costs.get(idea.id) ?? 0;
      const duration = idea.duration ?? 1;
      // Synthetic repo sinks deliberately have zero cost and are not persisted
      // user ideas. They do not have a meaningful profitability ratio.
      const priority = cost > 0
        ? calculateProfitabilityIndex(discountValue(estimatedValue, duration), cost)
        : 0;
      priorities.set(idea.id, priority);
  }

  return { values: currentValues, totalIntrinsic, flowShares, flowValues, attributionShares, costs, doneCosts, priorities };
}

/**
 * Share of each child's value that comes from each parent, keyed `${parentId}->${childId}`.
 *
 * Flow values are recorded before the per-step normalization, so they cannot be
 * compared with the (normalized) values directly. They can be compared with the
 * child's other inputs, which share their scale: the intrinsic value poured into
 * the child and the flows from its other parents. Self-retention (self weight,
 * leaf retention) is not an input from anyone, so it stays out. Shares of all
 * parents sum to 1, minus the part the child's own intrinsic value accounts for.
 * Without any value signal, parents share a child equally.
 */
function calculateAttributionShares(
  ideas: Idea[],
  ideaMap: Map<string, Idea>,
  flowValues: Map<string, number>,
  totalIntrinsic: number
): Map<string, number> {
  const parentsByChild = new Map<string, string[]>();
  for (const parent of ideas) {
    for (const connection of parent.supportingConnections ?? []) {
      if (!ideaMap.has(connection.ideaId) || connection.ideaId === parent.id) continue;
      const parents = parentsByChild.get(connection.ideaId) ?? [];
      parents.push(parent.id);
      parentsByChild.set(connection.ideaId, parents);
    }
  }

  const shares = new Map<string, number>();
  for (const [childId, parentIds] of parentsByChild) {
    const intrinsic = totalIntrinsic > 0 ? (ideaMap.get(childId)!.intrinsicValue ?? 0) / totalIntrinsic : 0;
    const inputs = parentIds.reduce((sum, parentId) => sum + (flowValues.get(`${parentId}->${childId}`) ?? 0), intrinsic);
    for (const parentId of parentIds) {
      shares.set(`${parentId}->${childId}`, inputs > 1e-12
        ? (flowValues.get(`${parentId}->${childId}`) ?? 0) / inputs
        : 1 / parentIds.length);
    }
  }
  return shares;
}

/**
 * Deterministic attributed-cost propagation. Strongly connected components are
 * collapsed before costs move from children to parents, preventing cycle
 * amplification. A cyclic component's result is allocated to its members in
 * proportion to their direct cost (equally if every basis is zero).
 */
function distributeCostsStable(
  ideas: Idea[],
  ideaMap: Map<string, Idea>,
  attributionShares: Map<string, number>,
  isDoneCost: boolean,
  totalCosts?: Map<string, number>
): Map<string, number> {
  const dependencies = new Map<string, { childId: string; share: number }[]>();
  for (const parent of ideas) {
    const deps: { childId: string; share: number }[] = [];
    for (const connection of parent.supportingConnections ?? []) {
      const childId = connection.ideaId;
      if (!ideaMap.has(childId)) continue;
      const share = attributionShares.get(`${parent.id}->${childId}`) ?? 0;
      if (share > 0) deps.push({ childId, share });
    }
    dependencies.set(parent.id, deps);
  }

  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string): void => {
    indexes.set(id, nextIndex);
    lowLinks.set(id, nextIndex++);
    stack.push(id);
    onStack.add(id);
    for (const { childId } of dependencies.get(id) ?? []) {
      if (!indexes.has(childId)) {
        visit(childId);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(childId)!));
      } else if (onStack.has(childId)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indexes.get(childId)!));
      }
    }
    if (lowLinks.get(id) !== indexes.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component);
  };
  for (const idea of ideas) if (!indexes.has(idea.id)) visit(idea.id);

  const componentOf = new Map<string, number>();
  components.forEach((members, componentId) =>
    members.forEach(id => componentOf.set(id, componentId)));
  const componentDependencies = new Map<number, Map<number, number>>();
  for (const parent of ideas) {
    // A completed idea's done cost is already its full attributed total; pulling
    // completed descendants again would double count it.
    if (isDoneCost && parent.status.state === 'implemented') continue;
    const parentComponent = componentOf.get(parent.id)!;
    for (const dependency of dependencies.get(parent.id) ?? []) {
      const childComponent = componentOf.get(dependency.childId)!;
      if (parentComponent === childComponent) continue;
      const outgoing = componentDependencies.get(parentComponent) ?? new Map<number, number>();
      outgoing.set(childComponent, (outgoing.get(childComponent) ?? 0) + dependency.share);
      componentDependencies.set(parentComponent, outgoing);
    }
  }

  const memberBasis = (id: string): number => {
    const idea = ideaMap.get(id)!;
    if (!isDoneCost) return idea.cost ?? 0;
    return idea.status.state === 'implemented' ? (totalCosts?.get(id) ?? 0) : 0;
  };
  const componentCosts = new Map<number, number>();
  const calculateComponent = (componentId: number): number => {
    const cached = componentCosts.get(componentId);
    if (cached !== undefined) return cached;
    let cost = components[componentId]!.reduce((sum, id) => sum + memberBasis(id), 0);
    for (const [childComponent, share] of componentDependencies.get(componentId) ?? []) {
      cost += calculateComponent(childComponent) * share;
    }
    componentCosts.set(componentId, cost);
    return cost;
  };

  const costs = new Map<string, number>();
  components.forEach((members, componentId) => {
    const componentCost = calculateComponent(componentId);
    const bases = members.map(memberBasis);
    const basisTotal = bases.reduce((sum, value) => sum + value, 0);
    members.forEach((id, memberIndex) => {
      const allocation = basisTotal > 0 ? bases[memberIndex]! / basisTotal : 1 / members.length;
      costs.set(id, componentCost * allocation);
    });
  });
  return costs;
}

// Remove old functions (commented out or just omitted in replacement)
/*
function calculateCosts(ideas: Idea[], ideaMap: Map<string, Idea>): Map<string, number> {
  // ...
}
function calculateDoneCosts(...) {
  // ...
} 
*/
