import { test } from 'node:test';
import assert from 'node:assert';
import { calculateAimValues } from './value-calculation.js';
import type { Aim } from './types.js';

function createMockAim(id: string, intrinsicValue: number, cost: number, duration?: number): Aim {
  return {
    id,
    text: `Aim ${id}`,
    intrinsicValue,
    cost,
    duration: duration || 1, // Default 1 day
    costVariance: 0,
    valueVariance: 0,
    reflections: [],
    status: { state: 'open', comment: '', date: Date.now() },
    supportingConnections: [],
    supportedAims: [],
    committedIn: [],
    tags: [],
    loopWeight: 0,
    archived: false
  };
}

test('calculateAimValues computes priority with temporal discounting', () => {
  // Test with explicit durations to show time-based discounting
  const aimA = createMockAim('A', 10, 5, 30);  // 30 days to complete
  const aimB = createMockAim('B', 500, 200, 365); // 1 year to complete

  const result = calculateAimValues([aimA, aimB]);

  // Total Intrinsic = 510
  // Value A = 10 (normalized)
  // Value B = 500 (normalized)

  // NEW priority formula uses duration for discounting:
  // priority = (PV - Cost) / Cost
  // where PV = value / (1 + DAILY_DISCOUNT_RATE)^duration
  // DAILY_DISCOUNT_RATE ≈ 0.000261 (from 10% annual)

  // Priority A: duration=30 days, minimal discounting
  // PV_A ≈ 10 / 1.000261^30 ≈ 10 / 1.0078 ≈ 9.92
  // Priority_A = (9.92 - 5) / 5 ≈ 0.98

  // Priority B: duration=365 days, significant discounting
  // PV_B ≈ 500 / 1.000261^365 ≈ 500 / 1.1 ≈ 454.5
  // Priority_B = (454.5 - 200) / 200 ≈ 1.27

  const priorityA = result.priorities?.get('A');
  const priorityB = result.priorities?.get('B');

  // With duration-based discounting, shorter-duration aims are prioritized
  // Both should be positive (net present value > cost)
  assert.ok(priorityA! > 0.9 && priorityA! < 1.1, `Priority A should be ~0.98, got ${priorityA}`);
  assert.ok(priorityB! > 1.0 && priorityB! < 1.5, `Priority B should be ~1.27, got ${priorityB}`);

  // Key insight: B has higher absolute priority despite longer duration
  // because its value/cost ratio is much better (500/200 vs 10/5)
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
