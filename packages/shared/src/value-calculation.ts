import type { Aim } from './types.js';
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

function validateEconomicInputs(aims: Aim[]): void {
  for (const aim of aims) {
    if (!Number.isFinite(aim.cost) || aim.cost <= 0) {
      throw new Error(`Aim "${aim.id}" has invalid cost: estimated direct cost must be a finite number greater than 0`);
    }
    const duration = aim.duration ?? 1;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(`Aim "${aim.id}" has invalid duration: days until return must be a finite number greater than or equal to 0`);
    }
    const intrinsicValue = aim.intrinsicValue ?? 0;
    if (!Number.isFinite(intrinsicValue) || intrinsicValue < 0) {
      throw new Error(`Aim "${aim.id}" has invalid intrinsic value: estimated direct value must be finite and non-negative`);
    }
  }
}

// Repo-level cross-repo links: a local aim's supportingRepos edge points at a
// WHOLE external repo (by repoId, no aimId — see RepoConnectionSchema). For
// value flow we model each referenced repo as ONE zero-intrinsic LEAF SINK node
// (its id IS the repoId) and turn every repo edge into an ordinary
// supportingConnection into that node, so the existing flow machinery handles it
// on a single code path. A leaf retains all inflow (effectiveLoopWeight 1), so
// flow is EXPORTED out of the local graph into the sink; totalIntrinsic is
// unchanged (repo nodes carry intrinsic 0) and local aims' retained values
// shrink by exactly the exported flow (value is conserved flow, not aggregate).
export function expandRepoSinkNodes(aims: Aim[]): Aim[] {
  // Fast path: no repo edges ⇒ nothing to merge, return the array untouched.
  if (!aims.some(a => a.supportingRepos && a.supportingRepos.length > 0)) {
    return aims;
  }

  const localIds = new Set(aims.map(a => a.id));
  const repoIds = new Set<string>();
  const expanded: Aim[] = [];

  for (const aim of aims) {
    if (aim.supportingRepos && aim.supportingRepos.length > 0) {
      // Clone (don't mutate the caller's aim) and fold each repo edge into
      // supportingConnections, targeting the repo node whose id is the repoId.
      const repoConnections = aim.supportingRepos.map(r => {
        repoIds.add(r.repoId);
        return {
          aimId: r.repoId,
          weight: r.weight ?? 1,
          relativePosition: (r.relativePosition ?? [0, 0]) as [number, number]
        };
      });
      expanded.push({
        ...aim,
        supportingConnections: [...(aim.supportingConnections ?? []), ...repoConnections]
      });
    } else {
      expanded.push(aim);
    }
  }

  // One leaf sink node per referenced repo. Skip a repoId that collides with a
  // real local aim id (already a node — don't shadow it).
  for (const repoId of repoIds) {
    if (!localIds.has(repoId)) {
      expanded.push(makeRepoSinkNode(repoId));
    }
  }

  return expanded;
}

function makeRepoSinkNode(repoId: string): Aim {
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
    supportedAims: [],
    committedIn: [],
    tags: [],
    loopWeight: 0,
    archived: false
  } as Aim;
}

export function calculateAimValues(inputAims: Aim[]): {
  values: Map<string, number>, 
  totalIntrinsic: number, 
  flowShares: Map<string, number>,
  flowValues: Map<string, number>,
  costs: Map<string, number>,
  doneCosts: Map<string, number>,
  priorities: Map<string, number>
} {
  validateEconomicInputs(inputAims);
  // Merge repo-link edges into zero-intrinsic leaf sink nodes before any
  // topology is built, so cross-repo flow runs on the same single code path.
  const aims = expandRepoSinkNodes(inputAims);

  const aimMap = new Map<string, Aim>();
  const currentValues = new Map<string, number>();
  const flowShares = new Map<string, number>();
  const flowValues = new Map<string, number>();
  let totalIntrinsic = 0;

  // 1. Initialize and Pre-calculate Topology
  // Map<ParentID, List<{TargetID, Share}>>
  const flowMatrix = new Map<string, { target: string, share: number }[]>();

  for (const aim of aims) {
    aimMap.set(aim.id, aim);
    totalIntrinsic += (aim.intrinsicValue ?? 0);
  }

  for (const parent of aims) {
    // Determine weights
    const rawLoopWeight = parent.loopWeight ?? 0; // schema default is 0 (pure pass-through)
    
    // Only count children that actually exist in the aimMap (prevent leaks)
    const validConnections = parent.supportingConnections?.filter(c => aimMap.has(c.aimId)) || [];
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
            distributions.push({ target: conn.aimId, share });
            // Store for UI visualization
            flowShares.set(`${parent.id}->${conn.aimId}`, share);
        }
    }
    
    flowMatrix.set(parent.id, distributions);
  }

  // 2. Initialize Values
  for (const aim of aims) {
    const intrinsic = aim.intrinsicValue ?? 0;
    currentValues.set(aim.id, totalIntrinsic > 0 ? intrinsic / totalIntrinsic : 0);
  }

  if (totalIntrinsic === 0) {
    const costs = distributeCostsStable(aims, aimMap, currentValues, flowValues, false);
    const doneCosts = distributeCostsStable(aims, aimMap, currentValues, flowValues, true, costs);
    const priorities = new Map(aims.map(aim => [aim.id, 0]));
    return { values: currentValues, totalIntrinsic: 0, flowShares, flowValues, costs, doneCosts, priorities };
  }

  // 3. Iterate
  const iterations = 100;
  // Epsilon for normalized values. Average is 1/N. 
  // Use 0.001 relative to average value for high precision.
  const epsilon = 0.001 * (1.0 / (aims.length || 1)); 
  // console.log(`[ValueCalc] Starting calculation. Nodes: ${aims.length}. Threshold: ${epsilon.toExponential(2)}`);

  for (let iter = 0; iter < iterations; iter++) {
    const nextValues = new Map<string, number>();

    // A. Add Intrinsic (Inflow)
    for (const aim of aims) {
      nextValues.set(aim.id, (aim.intrinsicValue ?? 0) / totalIntrinsic);
    }

    // B. Distribute Flow from Previous Step
    for (const parent of aims) {
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
    for (const aim of aims) {
      const oldV = currentValues.get(aim.id) || 0;
      const newV = nextValues.get(aim.id) || 0;
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
  for (const parent of aims) {
      const parentValue = currentValues.get(parent.id) || 0;
      const distributions = flowMatrix.get(parent.id) || [];
      for (const dist of distributions) {
          flowValues.set(`${parent.id}->${dist.target}`, parentValue * dist.share);
      }
  }

  // Use the flow values (Parent->Child) to compute cost shares (Child->Parent)
  const costs = distributeCostsStable(aims, aimMap, currentValues, flowValues, false);
  const doneCosts = distributeCostsStable(aims, aimMap, currentValues, flowValues, true, costs);

  // Priority is the positive profitability ratio: discounted estimated
  // flowed value divided by estimated present attributed cost. Variance fields
  // remain persisted for compatibility but are informational in this model.
  const priorities = new Map<string, number>();
  for (const aim of aims) {
      const estimatedValue = (currentValues.get(aim.id) ?? 0) * totalIntrinsic;
      const cost = costs.get(aim.id) ?? 0;
      const duration = aim.duration ?? 1;
      // Synthetic repo sinks deliberately have zero cost and are not persisted
      // user aims. They do not have a meaningful profitability ratio.
      const priority = cost > 0
        ? calculateProfitabilityIndex(discountValue(estimatedValue, duration), cost)
        : 0;
      priorities.set(aim.id, priority);
  }

  return { values: currentValues, totalIntrinsic, flowShares, flowValues, costs, doneCosts, priorities };
}

/**
 * Deterministic attributed-cost propagation. Strongly connected components are
 * collapsed before costs move from children to parents, preventing cycle
 * amplification. A cyclic component's result is allocated to its members in
 * proportion to their direct cost (equally if every basis is zero).
 */
function distributeCostsStable(
  aims: Aim[],
  aimMap: Map<string, Aim>,
  values: Map<string, number>,
  flowValues: Map<string, number>,
  isDoneCost: boolean,
  totalCosts?: Map<string, number>
): Map<string, number> {
  const childToParents = new Map<string, string[]>();
  for (const parent of aims) {
    for (const connection of parent.supportingConnections ?? []) {
      if (!aimMap.has(connection.aimId)) continue;
      const parents = childToParents.get(connection.aimId) ?? [];
      parents.push(parent.id);
      childToParents.set(connection.aimId, parents);
    }
  }
  const dependencies = new Map<string, { childId: string; share: number }[]>();
  for (const parent of aims) {
    const deps: { childId: string; share: number }[] = [];
    for (const connection of parent.supportingConnections ?? []) {
      const childId = connection.aimId;
      if (!aimMap.has(childId)) continue;
      const childValue = values.get(childId) ?? 0;
      const share = childValue > 1e-8
        ? (flowValues.get(`${parent.id}->${childId}`) ?? 0) / childValue
        : 1 / (childToParents.get(childId)?.length ?? 1);
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
  for (const aim of aims) if (!indexes.has(aim.id)) visit(aim.id);

  const componentOf = new Map<string, number>();
  components.forEach((members, componentId) =>
    members.forEach(id => componentOf.set(id, componentId)));
  const componentDependencies = new Map<number, Map<number, number>>();
  for (const parent of aims) {
    // A completed aim's done cost is already its full attributed total; pulling
    // completed descendants again would double count it.
    if (isDoneCost && parent.status.state === 'done') continue;
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
    const aim = aimMap.get(id)!;
    if (!isDoneCost) return aim.cost ?? 0;
    return aim.status.state === 'done' ? (totalCosts?.get(id) ?? 0) : 0;
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

function distributeCosts(
    aims: Aim[], 
    aimMap: Map<string, Aim>, 
    values: Map<string, number>, 
    flowValues: Map<string, number>,
    isDoneCost: boolean,
    totalCosts?: Map<string, number>
): Map<string, number> {
    const costs = new Map<string, number>();
    
    // Initialize with Intrinsic
    for (const aim of aims) {
        if (isDoneCost) {
            // For Done Cost:
            // If aim is done, its intrinsic "done cost" is its FULL Total Cost (passed in)
            // Wait, logic check:
            // If I am DONE, my DoneCost = My Total Cost.
            // But distributing up?
            // If I am DONE, I pass my full cost up as done cost.
            
            // However, the recursive logic was:
            // if (done) return totalCosts.get(id);
            // else return sum(children done costs).
            
            // So if I am Done, my "Intrinsic Done Contribution" is my Total Cost.
            // If I am Not Done, my "Intrinsic Done Contribution" is 0.
            
            if (aim.status.state === 'done') {
                costs.set(aim.id, totalCosts?.get(aim.id) || 0);
            } else {
                costs.set(aim.id, 0);
            }
        } else {
            costs.set(aim.id, aim.cost || 0);
        }
    }

    // Iterative Distribution (Child -> Parent)
    // We reuse the iterations count from values
    const iterations = 100;
    
    // To optimized, pre-calculate the "Share" factors for each connection
    // Share(Child->Parent) = Flow(Parent->Child) / Value(Child)
    // We need map: Parent -> List<{ChildID, Share}>
    // Wait, we need to PULL from children. 
    // Cost(Parent) = Intrinsic(Parent) + Sum(Cost(Child) * Share(Child->Parent))
    // So we need map: Parent -> List<{ChildID, Share}>.
    // Yes.
    
    const costDependencyMatrix = new Map<string, { childId: string, share: number }[]>();
    
    for (const parent of aims) {
        const deps: { childId: string, share: number }[] = [];
        const parentId = parent.id;
        
        // Children are in supportingConnections
        if (parent.supportingConnections) {
            for (const conn of parent.supportingConnections) {
                if (!aimMap.has(conn.aimId)) continue;
                
                const childId = conn.aimId;
                const childValue = values.get(childId) || 0;
                
                let share = 0;
                if (childValue > 0.00000001) {
                    // Value Share
                    const flowPtoC = flowValues.get(`${parentId}->${childId}`) || 0;
                    share = flowPtoC / childValue;
                } else {
                    // Fallback: Structural Share
                    // If child has 0 value, we can't use value share.
                    // Fallback to: 1 / NumberOfParents? Or weight/totalWeight?
                    // We don't have total incoming weight easily available here.
                    // Let's use 1 / (Number of Parents who support this child).
                    // Or simpler: just ignore cost flow if value is 0? 
                    // No, that hides cost.
                    // Let's assume equal split among connected parents for now to conserve mass.
                    // Ideally we'd scan all parents of this child.
                    // But here we are iterating parents.
                    // Let's calculate shares per Child first?
                }
                
                if (share > 0) {
                    deps.push({ childId, share });
                }
            }
        }
        costDependencyMatrix.set(parentId, deps);
    }
    
    // Handling the 0-value fallback properly:
    // We need to know for each child, what its parents are, to normalize structural shares.
    // Invert the graph temporarily.
    const childToParents = new Map<string, string[]>();
    for (const parent of aims) {
         if (parent.supportingConnections) {
            for (const conn of parent.supportingConnections) {
                if (!aimMap.has(conn.aimId)) continue;
                if (!childToParents.has(conn.aimId)) childToParents.set(conn.aimId, []);
                childToParents.get(conn.aimId)!.push(parent.id);
            }
         }
    }
    
    // Now fill in shares for 0-value children
    for (const [childId, parents] of childToParents) {
        const childValue = values.get(childId) || 0;
        if (childValue <= 0.00000001) {
            const share = 1.0 / parents.length;
            for (const pId of parents) {
                const deps = costDependencyMatrix.get(pId);
                if (deps) {
                    // Check if already added (unlikely if value was 0)
                    const existing = deps.find(d => d.childId === childId);
                    if (existing) {
                        existing.share = share;
                    } else {
                        deps.push({ childId, share });
                    }
                }
            }
        }
    }
    
    // Iterate
    for (let iter = 0; iter < iterations; iter++) {
        const nextCosts = new Map<string, number>();
        let maxChange = 0;
        
        for (const parent of aims) {
            let aggregatedCost = 0;
            const deps = costDependencyMatrix.get(parent.id);
            if (deps) {
                for (const dep of deps) {
                    const childCost = costs.get(dep.childId) || 0;
                    aggregatedCost += childCost * dep.share;
                }
            }
            
            // Add Intrinsic
            let intrinsic = 0;
            if (isDoneCost) {
                 if (parent.status.state === 'done') {
                     // If done, my cost is fixed to TotalCost (which is constant in this phase)
                     // So result is just TotalCost. aggregatedCost from children is IGNORED?
                     // Wait. If I am done, "My Done Cost" = "My Total Cost".
                     // Does "My Done Cost" include my children's done cost?
                     // Yes, conceptually. But if I am done, implicitly my children *should* be done or irrelevant?
                     // Actually, if I am marked Done manually, I assume full responsibility.
                     // The previous logic: `if (done) return totalCosts`
                     // This implies: If I am done, I override the sum of children.
                     intrinsic = totalCosts?.get(parent.id) || 0;
                     // And we do NOT add aggregatedCost.
                     nextCosts.set(parent.id, intrinsic);
                 } else {
                     // If not done, intrinsic is 0.
                     // Result is aggregatedCost.
                     nextCosts.set(parent.id, aggregatedCost);
                 }
            } else {
                intrinsic = parent.cost || 0;
                nextCosts.set(parent.id, intrinsic + aggregatedCost);
            }
        }
        
        // Convergence Check
        for (const [id, c] of nextCosts) {
            const oldC = costs.get(id) || 0;
            maxChange = Math.max(maxChange, Math.abs(c - oldC));
            costs.set(id, c);
        }
        
        if (maxChange < 0.001) break;
    }
    
    return costs;
}

// Remove old functions (commented out or just omitted in replacement)
/*
function calculateCosts(aims: Aim[], aimMap: Map<string, Aim>): Map<string, number> {
  // ...
}
function calculateDoneCosts(...) {
  // ...
} 
*/
