import type { Aim } from 'shared/src/types';

export function calculateAimValues(aims: Aim[]): { values: Map<string, number>, totalIntrinsic: number, flowShares: Map<string, number> } {
  const aimMap = new Map<string, Aim>();
  const currentValues = new Map<string, number>();
  const flowShares = new Map<string, number>();
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
    return { values: currentValues, totalIntrinsic: 0, flowShares };
  }

  // 3. Iterate
  const iterations = 100;
  // Epsilon for normalized values. Average is 1/N. 
  // Use 0.001 relative to average value for high precision.
  const epsilon = 0.001 * (1.0 / (aims.length || 1)); 
  console.log(`[ValueCalc] Starting calculation. Nodes: ${aims.length}. Threshold: ${epsilon.toExponential(2)}`);

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
      console.log(`[ValueCalc] Converged in ${iter + 1} iterations. Max Change: ${maxChange.toExponential(2)}`);
      break;
    } else if (iter === iterations - 1) {
      console.warn(`[ValueCalc] Reached max iterations (${iterations}). Final Max Change: ${maxChange.toExponential(2)}`);
    }
  }

  return { values: currentValues, totalIntrinsic, flowShares };
}
