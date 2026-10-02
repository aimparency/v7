import { test } from 'node:test';
import assert from 'node:assert';
import { calculateIdeaValues, calculateProfitabilityIndex, discountValue } from './value-calculation.js';
import type { Idea } from './types.js';

function createMockIdea(id: string, intrinsicValue: number, cost: number, duration?: number): Idea {
  return {
    id,
    text: `Idea ${id}`,
    intrinsicValue,
    cost,
    duration: duration ?? 1, // Zero means an immediate return
    costVariance: 0,
    valueVariance: 0,
    reflections: [],
    status: { state: 'open', comment: '', date: Date.now() },
    supportingConnections: [],
    supportedIdeas: [],
    committedIn: [],
    tags: [],
    loopWeight: 0,
    archived: false
  };
}

test('calculateIdeaValues computes priority with temporal discounting', () => {
  // Test with explicit durations to show time-based discounting
  const ideaA = createMockIdea('A', 10, 5, 30);  // 30 days to complete
  const ideaB = createMockIdea('B', 500, 200, 365); // 1 year to complete

  const result = calculateIdeaValues([ideaA, ideaB]);

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

  // With duration-based discounting, shorter-duration ideas are prioritized
  // Both should be positive (net present value > cost)
  assert.ok(priorityA! > 1.9 && priorityA! < 2.1, `Priority A should be ~1.98, got ${priorityA}`);
  assert.ok(priorityB! > 2.1 && priorityB! < 2.4, `Priority B should be ~2.27, got ${priorityB}`);

  // Key insight: B has higher absolute priority despite longer duration
  // because its value/cost ratio is much better (500/200 vs 10/5)
});

test('calculateIdeaValues distributes costs weighted by value share', () => {
  // Scenario: Roots A and B both support C.
  // C has high cost. A and B should split that cost.
  
  const ideaA = createMockIdea('A', 10, 1);
  const ideaB = createMockIdea('B', 10, 1);
  const ideaC = createMockIdea('C', 0, 100);

  // A -> C
  ideaA.supportingConnections = [{ ideaId: 'C', weight: 1, relativePosition: [0,0] }];
  ideaC.supportedIdeas = ['A', 'B']; // Just for consistency, calculation uses parent's connections

  // B -> C
  ideaB.supportingConnections = [{ ideaId: 'C', weight: 1, relativePosition: [0,0] }];

  const result = calculateIdeaValues([ideaA, ideaB, ideaC]);

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
  ideaA.loopWeight = 0;
  ideaB.loopWeight = 0;
  
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
  assert.ok(Math.abs(costA! - 51) < 0.1, `A Cost should be 51, got ${costA}`);
  assert.ok(Math.abs(costB! - 51) < 0.1, `B Cost should be 51, got ${costB}`);
});

test('repo-link edge exports flow into a leaf sink, leaving totalIntrinsic unchanged', () => {
  // Boundary fixture with a control. A and B each carry intrinsic 100, but ONLY
  // A leans on a WHOLE external repo R (a single black-box sink). A exports its
  // flow into R; B keeps to itself. Value is conserved flow, so A's retained
  // value shrinks by exactly what it exports, while B (the control) keeps its
  // full intrinsic. R carries no intrinsic, so totalIntrinsic stays = the local
  // intrinsics (200) — the repo node adds boundary, not value.
  const REPO_ID = '11111111-1111-4111-8111-111111111111';
  const ideaA = createMockIdea('A', 100, 1);
  ideaA.loopWeight = 0; // send everything downstream into the repo, retain nothing structurally
  ideaA.supportingRepos = [{ repoId: REPO_ID, weight: 1, relativePosition: [0, 0] }];
  const ideaB = createMockIdea('B', 100, 1); // control: no repo link

  const result = calculateIdeaValues([ideaA, ideaB]);

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

test('economic helpers use annual discounting and a positive ratio', () => {
  assert.strictEqual(discountValue(110, 0), 110);
  assert.ok(Math.abs(discountValue(110, 365) - 100) < 1e-10);
  assert.ok(Math.abs(discountValue(121, 730) - 100) < 1e-10);
  assert.ok(discountValue(100, 0.5) < 100);
  assert.strictEqual(calculateProfitabilityIndex(10, 10), 1);
  assert.strictEqual(calculateProfitabilityIndex(20, 10), 2);
  assert.strictEqual(calculateProfitabilityIndex(10, 20), 0.5);
});

test('missing duration defaults to one day while zero remains immediate', () => {
  const missing = createMockIdea('missing', 100, 100);
  const backwardCompatibleMissing = { ...missing, duration: undefined } as unknown as Idea;
  const immediate = createMockIdea('immediate', 100, 100, 0);
  const result = calculateIdeaValues([backwardCompatibleMissing, immediate]);
  assert.ok(result.priorities.get('immediate')! > result.priorities.get('missing')!);
});

test('variance is informational and does not alter priority', () => {
  const plain = createMockIdea('plain', 10, 5, 0);
  const uncertain = createMockIdea('uncertain', 10, 5, 0);
  uncertain.costVariance = 999;
  uncertain.valueVariance = 999;
  const result = calculateIdeaValues([plain, uncertain]);
  assert.strictEqual(result.priorities.get('plain'), result.priorities.get('uncertain'));
});

test('invalid real economic inputs identify the idea', () => {
  assert.throws(() => calculateIdeaValues([createMockIdea('bad-cost', 1, 0)]), /Idea "bad-cost".*cost/);
  assert.throws(() => calculateIdeaValues([createMockIdea('bad-duration', 1, 1, -1)]), /Idea "bad-duration".*duration/);
  assert.throws(
    () => calculateIdeaValues([createMockIdea('infinite-duration', 1, 1, Number.POSITIVE_INFINITY)]),
    /Idea "infinite-duration".*duration/
  );
});

test('cyclic attributed costs are deterministic and count direct costs once', () => {
  const a = createMockIdea('cycle-a', 10, 2, 0);
  const b = createMockIdea('cycle-b', 10, 3, 0);
  a.supportingConnections = [{ ideaId: b.id, weight: 1, relativePosition: [0, 0] }];
  b.supportingConnections = [{ ideaId: a.id, weight: 1, relativePosition: [0, 0] }];
  const first = calculateIdeaValues([a, b]).costs;
  const second = calculateIdeaValues([a, b]).costs;
  assert.deepStrictEqual(first, second);
  assert.ok(Math.abs(first.get(a.id)! - 2) < 1e-10);
  assert.ok(Math.abs(first.get(b.id)! - 3) < 1e-10);
});
