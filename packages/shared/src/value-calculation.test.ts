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

test('repo-link edge exports flow into a leaf sink, leaving totalIntrinsic unchanged', () => {
  // Boundary fixture with a control. A and B each carry intrinsic 100, but ONLY
  // A leans on a WHOLE external repo R (a single black-box sink). A exports its
  // flow into R; B keeps to itself. Value is conserved flow, so A's retained
  // value shrinks by exactly what it exports, while B (the control) keeps its
  // full intrinsic. R carries no intrinsic, so totalIntrinsic stays = the local
  // intrinsics (200) — the repo node adds boundary, not value.
  const REPO_ID = '11111111-1111-4111-8111-111111111111';
  const aimA = createMockAim('A', 100, 0);
  aimA.loopWeight = 0; // send everything downstream into the repo, retain nothing structurally
  aimA.supportingRepos = [{ repoId: REPO_ID, weight: 1, relativePosition: [0, 0] }];
  const aimB = createMockAim('B', 100, 0); // control: no repo link

  const result = calculateAimValues([aimA, aimB]);

  // Repo node carries no intrinsic ⇒ the total is just A + B's intrinsics.
  assert.strictEqual(result.totalIntrinsic, 200, 'totalIntrinsic must stay = local intrinsics');

  // A sink node exists in the value map, keyed by the repoId.
  const repoFraction = result.values.get(REPO_ID);
  assert.ok(repoFraction !== undefined, 'a sink node should be created for the linked repo');

  // Steady state (each leaf retains via its self-loop): A and its sink split
  // A's mass evenly, while B retains its own — fractions 0.25 / 0.5 / 0.25.
  const aFraction = result.values.get('A')!;
  const bFraction = result.values.get('B')!;
  assert.ok(Math.abs(aFraction - 0.25) < 0.01, `A should retain ~0.25, got ${aFraction}`);
  assert.ok(Math.abs(bFraction - 0.5) < 0.01, `B (control) should retain ~0.5, got ${bFraction}`);
  assert.ok(Math.abs(repoFraction! - 0.25) < 0.01, `sink should hold ~0.25, got ${repoFraction}`);

  // Concretely (×200): A keeps 50 of its 100 — half EXPORTED into the repo sink
  // (also 50) — while the control B keeps its full 100. Fractions partition 1.
  assert.ok(aFraction * 200 < 100, 'A must retain less than its full intrinsic (flow exported)');
  assert.ok(Math.abs(bFraction * 200 - 100) < 0.5, 'B (no repo link) must keep its full intrinsic');
  assert.ok(repoFraction! * 200 > 0, 'the repo sink must hold exported value');
  assert.ok(Math.abs(aFraction + bFraction + repoFraction! - 1) < 1e-9, 'fractions partition the conserved flow');

  // The export shows up as a parent→repo flow edge for the renderer to size.
  const exportedFlow = result.flowValues.get(`A->${REPO_ID}`);
  assert.ok(exportedFlow !== undefined && exportedFlow > 0, 'a parent→repo flow edge should exist');
});
