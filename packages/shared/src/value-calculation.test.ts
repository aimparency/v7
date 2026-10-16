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
  // A and B each carry intrinsic 100, but only A leans on a whole external repo
  // (a single black-box sink). A hands everything on to the sink; B keeps its own.
  const REPO_ID = '11111111-1111-4111-8111-111111111111';
  const ideaA = createMockIdea('A', 100, 1);
  ideaA.supportingRepos = [{ repoId: REPO_ID, weight: 1, relativePosition: [0, 0] }];
  const ideaB = createMockIdea('B', 100, 1); // control: no repo link

  const result = calculateIdeaValues([ideaA, ideaB]);

  // The repo node carries no intrinsic value: the total is just A's and B's.
  assert.strictEqual(result.totalIntrinsic, 200);
  const realized = (id: string) => result.realizedValues.get(id)! * 200;
  assert.ok(Math.abs(realized('A')) < 1e-9, 'A exports all of its value');
  assert.ok(Math.abs(realized(REPO_ID) - 100) < 1e-9, 'the sink realizes what A exports');
  assert.ok(Math.abs(realized('B') - 100) < 1e-9, 'B (no repo link) keeps its own');
  assert.ok(Math.abs(result.values.get('A')! * 200 - 100) < 1e-9, 'A still has its value at stake');
  assert.ok(result.flowValues.get(`A->${REPO_ID}`)! > 0, 'a parent→repo flow edge should exist');
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

test('a closed cycle acts as one idea: each member costs the cycle once', () => {
  const a = createMockIdea('cycle-a', 10, 2, 0);
  const b = createMockIdea('cycle-b', 10, 3, 0);
  a.supportingConnections = [{ ideaId: b.id, weight: 1, relativePosition: [0, 0] }];
  b.supportingConnections = [{ ideaId: a.id, weight: 1, relativePosition: [0, 0] }];
  const first = calculateIdeaValues([a, b]).costs;
  const second = calculateIdeaValues([a, b]).costs;
  assert.deepStrictEqual(first, second);
  assert.ok(Math.abs(first.get(a.id)! - 5) < 1e-10);
  assert.ok(Math.abs(first.get(b.id)! - 5) < 1e-10);
});

function connect(parent: Idea, child: Idea, weight = 1) {
  parent.supportingConnections.push({ ideaId: child.id, weight, relativePosition: [0, 0] });
  child.supportedIdeas.push(parent.id);
}

test('intermediate ideas pass their full cost up a chain, not a normalization multiple', () => {
  // root -> mid -> leaf, each costing 10. Every idea is the only way to get its
  // parent done, so each parent carries its whole sub-chain exactly once.
  const root = createMockIdea('root', 100, 10);
  const mid = createMockIdea('mid', 0, 10);
  const leaf = createMockIdea('leaf', 0, 10);
  connect(root, mid);
  connect(mid, leaf);

  const { costs, attributionShares } = calculateIdeaValues([root, mid, leaf]);

  assert.ok(Math.abs(attributionShares.get('root->mid')! - 1) < 1e-6);
  assert.ok(Math.abs(attributionShares.get('mid->leaf')! - 1) < 1e-6);
  assert.ok(Math.abs(costs.get('leaf')! - 10) < 1e-6);
  assert.ok(Math.abs(costs.get('mid')! - 20) < 1e-6);
  assert.ok(Math.abs(costs.get('root')! - 30) < 1e-6);
});

test('attribution shares split an idea between its parents by the value each sends', () => {
  // goal splits evenly into big and small; big and small both feed shared.
  // big sends shared all of its value, small only half (small keeps a self weight).
  const goal = createMockIdea('goal', 100, 1);
  const big = createMockIdea('big', 0, 1);
  const small = createMockIdea('small', 0, 1);
  const shared = createMockIdea('shared', 0, 1);
  connect(goal, big);
  connect(goal, small);
  connect(big, shared);
  connect(small, shared);
  small.loopWeight = 1;

  const { attributionShares, flowValues } = calculateIdeaValues([goal, big, small, shared]);

  const fromBig = attributionShares.get('big->shared')!;
  const fromSmall = attributionShares.get('small->shared')!;
  assert.ok(Math.abs(fromBig + fromSmall - 1) < 1e-6, `shares sum to ${fromBig + fromSmall}`);
  // Scale-free: the shares keep the ratio of the flows themselves.
  const flowRatio = flowValues.get('big->shared')! / flowValues.get('small->shared')!;
  assert.ok(Math.abs(fromBig / fromSmall - flowRatio) < 1e-6);
  assert.ok(Math.abs(fromBig / fromSmall - 2) < 1e-6);
});

test('an idea with intrinsic value of its own attributes only the rest to its parents', () => {
  const goal = createMockIdea('goal', 100, 1);
  const child = createMockIdea('child', 100, 1);
  connect(goal, child);

  const { attributionShares } = calculateIdeaValues([goal, child]);

  const share = attributionShares.get('goal->child')!;
  assert.ok(share > 0 && share < 1, `share ${share}`);
});

// Hand-computed examples, mirrored in math/examples.py. Nodes: i = intrinsic
// value, c = direct cost (1), s = self weight (0). Edges: [idea, idea it builds on, weight].
type Spec = Record<string, { i?: number, c?: number, s?: number }>;
type Quantity = 'values' | 'realizedValues' | 'costs' | 'priorities';

const examples: [string, Spec, [string, string, number?][], Partial<Record<Quantity, Record<string, number>>>][] = [
  ['self weight splits value', { A: { i: 2, s: 5 }, B: {} }, [['A', 'B', 5]],
    { realizedValues: { A: 1, B: 1 }, values: { A: 2, B: 1 }, costs: { A: 2, B: 1 }, priorities: { A: 1, B: 1 } }],
  ['pass-through chain', { R: { i: 1 }, A: {}, B: {} }, [['R', 'A'], ['A', 'B']],
    { realizedValues: { R: 0, A: 0, B: 1 }, values: { R: 1, A: 1, B: 1 }, costs: { R: 3, A: 2, B: 1 }, priorities: { R: 1 / 3, A: 1 / 2, B: 1 } }],
  ['weights split value', { R: { i: 3 }, A: {}, B: {} }, [['R', 'A', 1], ['R', 'B', 2]],
    { realizedValues: { A: 1, B: 2 }, values: { R: 3, A: 1, B: 2 }, costs: { R: 3 }, priorities: { R: 1, A: 1, B: 2 } }],
  ['diamond shares its base', { R: { i: 4 }, A: {}, B: {}, C: {} }, [['R', 'A'], ['R', 'B'], ['A', 'C'], ['B', 'C']],
    { values: { R: 4, A: 2, C: 4 }, costs: { R: 4, A: 1.5, B: 1.5, C: 1 }, priorities: { R: 1, A: 4 / 3, C: 4 } }],
  ['unequal parents share by value', { R1: { i: 3 }, R2: { i: 1 }, C: {} }, [['R1', 'C'], ['R2', 'C']],
    { values: { R1: 3, R2: 1, C: 4 }, costs: { R1: 1.75, R2: 1.25, C: 1 } }],
  ['intrinsic value below', { R: { i: 2 }, C: { i: 2 } }, [['R', 'C']],
    { values: { R: 2, C: 4 }, costs: { R: 1.5, C: 1 } }],
  ['leaky cycle', { R: { i: 1 }, A: {}, B: { s: 1 } }, [['R', 'A'], ['A', 'B'], ['B', 'A']],
    { realizedValues: { R: 0, A: 0, B: 1 }, values: { R: 1, A: 1, B: 1 }, costs: { R: 3, A: 2, B: 1.5 }, priorities: { R: 1 / 3, A: 1 / 2, B: 2 / 3 } }],
  ['closed cycle', { R: { i: 1 }, A: {}, B: {} }, [['R', 'A'], ['A', 'B'], ['B', 'A']],
    { realizedValues: { A: 0.5, B: 0.5 }, values: { R: 1, A: 1, B: 1 }, costs: { R: 3, A: 2, B: 2 }, priorities: { R: 1 / 3, A: 1 / 2 } }],
  ['root with self weight', { R: { i: 3, s: 1 }, A: {}, B: {} }, [['R', 'A'], ['R', 'B']],
    { realizedValues: { R: 1, A: 1, B: 1 }, values: { R: 3, A: 1 }, costs: { R: 3 }, priorities: { R: 1, A: 1 } }],
  ['unreached ideas still aggregate cost', { R: { i: 1 }, X: {}, Y: { c: 2 } }, [['X', 'Y']],
    { values: { X: 0 }, costs: { X: 3, Y: 2 }, priorities: { X: 0, Y: 0 } }],
];

for (const [name, spec, edges, expected] of examples) {
  test(`example: ${name}`, () => {
    const ideas = Object.entries(spec).map(([id, { i = 0, c = 1, s = 0 }]) => {
      const idea = createMockIdea(id, i, c, 0); // duration 0: no discounting
      idea.loopWeight = s;
      return idea;
    });
    const byId = new Map(ideas.map(idea => [idea.id, idea]));
    for (const [parent, child, weight] of edges) connect(byId.get(parent)!, byId.get(child)!, weight);
    const result = calculateIdeaValues(ideas);
    for (const [quantity, nodes] of Object.entries(expected) as [Quantity, Record<string, number>][]) {
      // values are fractions of the total intrinsic value; compare in its units
      const scale = quantity === 'values' || quantity === 'realizedValues' ? result.totalIntrinsic : 1;
      for (const [id, want] of Object.entries(nodes)) {
        const got = result[quantity].get(id)! * scale;
        assert.ok(Math.abs(got - want) < 1e-9, `${quantity}[${id}] = ${got}, expected ${want}`);
      }
    }
  });
}
