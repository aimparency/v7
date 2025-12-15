import type { Aim } from 'shared/src/types';

export function calculateAimValues(aims: Aim[]): { values: Map<string, number>, totalIntrinsic: number, flowShares: Map<string, number> } {
  const aimMap = new Map<string, Aim>();
  const currentValues = new Map<string, number>();
  const flowShares = new Map<string, number>();
  let totalIntrinsic = 0;

  for (const aim of aims) {
    aimMap.set(aim.id, aim);
    totalIntrinsic += (aim.intrinsicValue ?? 0);
  }

  // Calculate Flow Shares
  for (const parent of aims) {
    const loopWeight = parent.loopWeight ?? 1;
    const childrenWeights = parent.supportingConnections?.reduce((sum: number, c: any) => sum + (c.weight || 1), 0) || 0;
    const totalWeight = loopWeight + childrenWeights;

    if (totalWeight > 0) {
      if (parent.supportingConnections) {
        for (const conn of parent.supportingConnections) {
          const share = (conn.weight || 1) / totalWeight;
          flowShares.set(`${parent.id}->${conn.aimId}`, share);
        }
      }
    }
  }

  // Initialize values (normalized)
  for (const aim of aims) {
    const intrinsic = aim.intrinsicValue ?? 0;
    currentValues.set(aim.id, totalIntrinsic > 0 ? intrinsic / totalIntrinsic : 0);
  }

  if (totalIntrinsic === 0) {
    return { values: currentValues, totalIntrinsic: 0, flowShares };
  }

  const iterations = 100;
  // Epsilon for normalized values. Average is 1/N. 0.001 * (1/N).
  const epsilon = 0.001 * (1.0 / aims.length); 

  for (let iter = 0; iter < iterations; iter++) {
    const nextValues = new Map<string, number>();

    // 1. Initialize with Intrinsic Inflow (Normalized)
    for (const aim of aims) {
      nextValues.set(aim.id, (aim.intrinsicValue ?? 0) / totalIntrinsic);
    }

    // 2. Distribute Value from Parents (using currentValues)
    for (const parent of aims) {
      const parentValue = currentValues.get(parent.id) || 0;
      
      const loopWeight = parent.loopWeight ?? 1;
      // Only count children that actually exist in the aimMap
      const validConnections = parent.supportingConnections?.filter(c => aimMap.has(c.aimId)) || [];
      const childrenWeights = validConnections.reduce((sum: number, c: any) => sum + (c.weight || 1), 0);
      const totalWeight = loopWeight + childrenWeights;

      if (totalWeight > 0) {
        // Distribute to Self (Loop)
        if (loopWeight > 0) {
          const flow = parentValue * (loopWeight / totalWeight);
          nextValues.set(parent.id, (nextValues.get(parent.id) || 0) + flow);
        }

        // Distribute to Children
        if (parent.supportingConnections) {
          for (const conn of parent.supportingConnections) {
            const childId = conn.aimId;
            if (aimMap.has(childId)) {
              const weight = conn.weight || 1;
              const flow = parentValue * (weight / totalWeight);
              nextValues.set(childId, (nextValues.get(childId) || 0) + flow);
            }
          }
        }
      } else {
        // Special case: Total weight 0 (Loop=0, Children=0)
        // Treat as 100% retention to prevent value destruction at leafs
        const flow = parentValue * 1.0;
        nextValues.set(parent.id, (nextValues.get(parent.id) || 0) + flow);
      }
    }

    // 3. Normalize to 1.0
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

    // 4. Check Convergence
    let maxChange = 0;
    for (const aim of aims) {
      const oldV = currentValues.get(aim.id) || 0;
      const newV = nextValues.get(aim.id) || 0;
      maxChange = Math.max(maxChange, Math.abs(newV - oldV));
    }

    // Update values
    for (const [id, val] of nextValues) {
      currentValues.set(id, val);
    }

    if (maxChange < epsilon) {
      break;
    }
  }

  return { values: currentValues, totalIntrinsic, flowShares };
}