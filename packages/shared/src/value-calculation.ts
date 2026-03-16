import type { Aim } from './types.js';
import { DISCOUNT_RATE, DAILY_DISCOUNT_RATE } from './constants.js';

export function calculateAimValues(aims: Aim[]): { 
  values: Map<string, number>, 
  totalIntrinsic: number, 
  flowShares: Map<string, number>,
  flowValues: Map<string, number>,
  costs: Map<string, number>,
  doneCosts: Map<string, number>,
  priorities: Map<string, number>
} {
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
    const rawLoopWeight = parent.loopWeight ?? 1;
    
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
    const costs = distributeCosts(aims, aimMap, currentValues, flowValues, false);
    const doneCosts = distributeCosts(aims, aimMap, currentValues, flowValues, true, costs);
    return { values: currentValues, totalIntrinsic: 0, flowShares, flowValues, costs, doneCosts, priorities: new Map() };
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
  const costs = distributeCosts(aims, aimMap, currentValues, flowValues, false);
  const doneCosts = distributeCosts(aims, aimMap, currentValues, flowValues, true, costs);

  // Calculate Priorities with temporal discounting
  // Priority = NPV / Cost = (PV of returns - Cost) / Cost
  // Where PV uses duration (time to completion), not cost
  const priorities = new Map<string, number>();
  for (const aim of aims) {
      const val = (currentValues.get(aim.id) || 0) * totalIntrinsic;
      const cost = costs.get(aim.id) || 0;
      const duration = aim.duration || 1; // Default 1 day if not specified
      const valueVariance = aim.valueVariance || 0;
      const costVariance = aim.costVariance || 0;

      let priority = 0;
      if (cost > 0) {
          // Temporal discounting: discount by actual time to completion (duration)
          const discountFactor = Math.pow(1 + DAILY_DISCOUNT_RATE, duration);
          const presentValue = val / discountFactor;

          // Risk adjustment: reduce value by uncertainty
          // Simple approach: subtract some multiple of variance as risk penalty
          // More sophisticated: use certainty equivalence or utility functions
          const riskAdjustedValue = presentValue - (valueVariance * 0.5);
          const riskAdjustedCost = cost + (costVariance * 0.5);

          // ROI = (Present Value - Cost) / Cost
          // Higher priority = better return on investment considering time value of money
          const netPresentValue = riskAdjustedValue - riskAdjustedCost;
          priority = netPresentValue / riskAdjustedCost;
      } else if (val > 0) {
          priority = Number.POSITIVE_INFINITY;
      }
      priorities.set(aim.id, priority);
  }

  return { values: currentValues, totalIntrinsic, flowShares, flowValues, costs, doneCosts, priorities };
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
