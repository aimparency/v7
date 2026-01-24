import { test } from 'node:test';
import assert from 'node:assert';
import { calculateAimValues } from './value-calculation.js';
import type { Aim } from './types.js';

function createMockAim(id: string, intrinsicValue: number, cost: number): Aim {
  return {
    id,
    text: `Aim ${id}`,
    intrinsicValue,
    cost,
    status: { state: 'open', comment: '', date: Date.now() },
    supportingConnections: [],
    supportedAims: [],
    committedIn: [],
    tags: [],
    loopWeight: 0
  };
}

test('calculateAimValues computes priority correctly', () => {
  const aimA = createMockAim('A', 10, 5);
  const aimB = createMockAim('B', 500, 200);

  const result = calculateAimValues([aimA, aimB]);

  // Check simple value/cost (Total Intrinsic = 510)
  // Value A (norm) = 10/510
  // Value B (norm) = 500/510
  
  // Cost A = 5
  // Cost B = 200

  // Priority A = (10/510 * 510) / 5 = 2
  // Priority B = (500/510 * 510) / 200 = 2.5
  
  // Need to verify if 'priority' is returned. 
  // The current function returns { values, costs ... } but not priorities explicitly mapped?
  // Or does it mutate the aims? The function returns maps.
  // The types.ts says Aim has 'calculatedValue' etc. but those are likely populated *after* calling this function 
  // in the actual application code, OR we should update calculateAimValues to return priorities too.
  
  // Let's assume we want calculateAimValues to return a 'priorities' map.
  
  const priorityA = result.priorities?.get('A');
  const priorityB = result.priorities?.get('B');

  // Use approximate equality for floating point
  assert.ok(Math.abs(priorityA! - 2) < 0.5, `Priority A should be ~2, got ${priorityA}`);
  assert.ok(Math.abs(priorityB! - 2.5) < 0.5, `Priority B should be ~2.5, got ${priorityB}`);
});

test('calculateAimValues distributes costs weighted by value share', () => {
  // Scenario: Roots A and B both support C.
  // C has high cost. A and B should split that cost.
  
  const aimA = createMockAim('A', 10, 0);
  const aimB = createMockAim('B', 10, 0);
  const aimC = createMockAim('C', 0, 100);

  // A -> C
  aimA.supportingConnections = [{ aimId: 'C', weight: 1, relativePosition: [0,0] }];
  aimC.supportedAims = ['A', 'B']; // Just for consistency, calculation uses parent's connections

  // B -> C
  aimB.supportingConnections = [{ aimId: 'C', weight: 1, relativePosition: [0,0] }];

  const result = calculateAimValues([aimA, aimB, aimC]);

  // Total Intrinsic Value = 20.
  // A Value = 10/20 = 0.5
  // B Value = 10/20 = 0.5
  
  // C receives flow from A (0.5) and B (0.5).
  // C Total Value ~ 0.5 + 0.5 = 1.0 (assuming weights align)
  // Actually, A and B are leaves in terms of inflow, but they loop? 
  // No, in the current logic, A and B are roots (have intrinsic).
  // A (Loop 1 + Child C 1) -> Total Weight 2.
  // Flow A->A = 0.5 * 0.5 = 0.25?
  // Flow A->C = 0.5 * 0.5 = 0.25?
  
  // Let's force loopWeight=0 for A and B to send ALL value to C
  aimA.loopWeight = 0;
  aimB.loopWeight = 0;
  
  // Now:
  // A (Weight 1 to C). Total 1. Flow A->C = 100% of A's value.
  // B (Weight 1 to C). Total 1. Flow B->C = 100% of B's value.
  
  // Value Distribution:
  // A = 0.5 (intrinsic)
  // B = 0.5 (intrinsic)
  // C = (0.5 from A) + (0.5 from B) = 1.0.
  
  // Cost Distribution:
  // C Cost = 100.
  // C gets 0.5 from A, 0.5 from B.
  // Share A = 0.5 / 1.0 = 50%.
  // Share B = 0.5 / 1.0 = 50%.
  
  // Cost A = IC_A(0) + 50% of C(100) = 50.
  // Cost B = IC_B(0) + 50% of C(100) = 50.

  const costA = result.costs.get('A');
  const costB = result.costs.get('B');
  const costC = result.costs.get('C');

  assert.strictEqual(costC, 100, 'C Cost should be 100');
  
  // Allow small floating point diff
  assert.ok(Math.abs(costA! - 50) < 0.1, `A Cost should be 50, got ${costA}`);
  assert.ok(Math.abs(costB! - 50) < 0.1, `B Cost should be 50, got ${costB}`);
});
