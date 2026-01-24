import { test } from 'node:test';
import assert from 'node:assert';
import { calculateAimValues } from 'shared';
import type { Aim } from 'shared';

test('calculateAimValues - simple distribution', () => {
  const aims: Aim[] = [
    {
      id: 'root',
      text: 'Root',
      status: { state: 'open', comment: '', date: 0 },
      intrinsicValue: 100,
      cost: 1,
      supportingConnections: [
        { aimId: 'child1', weight: 1, relativePosition: [0,0] },
        { aimId: 'child2', weight: 1, relativePosition: [0,0] }
      ],
      supportedAims: [],
      committedIn: []
    } as any,
    {
      id: 'child1',
      text: 'Child 1',
      status: { state: 'open', comment: '', date: 0 },
      intrinsicValue: 0,
      cost: 2,
      supportingConnections: [],
      supportedAims: ['root'],
      committedIn: []
    } as any,
    {
      id: 'child2',
      text: 'Child 2',
      status: { state: 'open', comment: '', date: 0 },
      intrinsicValue: 0,
      cost: 3,
      supportingConnections: [],
      supportedAims: ['root'],
      committedIn: []
    } as any
  ];

  const result = calculateAimValues(aims);

  // Intrinsic value 100 distributed.
  // Root splits 100 to children? 
  // Wait, loopWeight is default 0.
  // Root has 2 children. Weight sum = 2.
  // Root -> Child1: 1/2
  // Root -> Child2: 1/2
  // Value flows FROM parent TO child?
  // No, standard value flow usually goes from Goal (Root) down to Means (Children) if we consider "Value" as "Importance derived from Goal".
  // Yes, that's what the code does: parentValue * share -> target.
  
  // However, iterative calc might be normalized.
  // Intrinsic 100 -> Normalized to 1.0 (since it's the only source).
  
  // Iteration 0:
  // Root: 1.0 (from intrinsic)
  // Child1: 0
  // Child2: 0
  
  // Iteration 1:
  // Root distributes 1.0 -> 0.5 to C1, 0.5 to C2.
  // Root gets 1.0 from intrinsic again? 
  // Logic: "A. Add Intrinsic... B. Distribute Flow... C. Normalize"
  // Yes.
  
  // Convergence:
  // Root receives 1.0 intrinsic every step.
  // It pushes 0.5 to C1, 0.5 to C2.
  // C1 and C2 have no children, so they retain?
  // "Leaf Retention Logic: If no outgoing flow... force effective loop to 1".
  // So C1 retains. C2 retains.
  
  // Steady state:
  // Root: 1.0 (constantly replenished) -> Output 1.0
  // C1: Receives 0.5. Retains 0.5. (Accumulates? No, "Distribute Flow from Previous Step". Previous value is used to calculate flow, but nextValues is reset).
  // Wait, "Loop Flow" adds to self.
  // C1 has loop 1 (forced).
  // C1 Value = Previous(C1) * 1.0 + FlowFrom(Root).
  // If Root=1, C1=0.5. Next: C1 = 0.5 + 0.5 = 1.0. Next: 1.0 + 0.5 = 1.5...
  // But we Normalize sum to 1.0.
  
  // Let's see.
  // Total Value in system should be 1.0.
  // If Root keeps pumping, and Leafs keep retaining...
  // Relative values will settle.
  
  const vRoot = result.values.get('root') || 0;
  const vChild1 = result.values.get('child1') || 0;
  const vChild2 = result.values.get('child2') || 0;

  // Expect Root to have value, and Children to have value.
  assert.ok(vRoot > 0);
  assert.ok(vChild1 > 0);
  assert.ok(vChild2 > 0);
  
  // Costs:
  // Root cost = self(1) + children(2+3) = 6
  assert.ok(Math.abs(result.costs.get('root')! - 6) < 0.01);
  assert.ok(Math.abs(result.costs.get('child1')! - 2) < 0.01);
  assert.ok(Math.abs(result.costs.get('child2')! - 3) < 0.01);
});
