import { test } from 'node:test';
import assert from 'node:assert';
import { planSpinOff, computeSpinOff } from './spin-off.js';
import type { Aim, Connection } from './types.js';

function conn(aimId: string): Connection {
  return { aimId, relativePosition: [0, 0], weight: 1 };
}

/** Build an aim. parents = supportedAims (up); children = supportingConnections (down). */
function aim(id: string, parents: string[], children: string[], committedIn: string[] = []): Aim {
  return {
    id,
    text: id,
    reflections: [],
    archived: false,
    tags: [],
    supportingConnections: children.map(conn),
    supportedAims: parents,
    committedIn,
    status: { state: 'open', comment: '', date: 0 },
    intrinsicValue: 0,
    cost: 1,
    loopWeight: 0,
    duration: 1,
    costVariance: 0,
    valueVariance: 0,
  };
}

const sorted = (xs: string[]) => [...xs].sort();

// A (top); B->A; C->B; D->A and D->B. Export root B.
function exampleGraph(): Aim[] {
  return [
    aim('A', [], ['B', 'D']),
    aim('B', ['A'], ['C', 'D']),
    aim('C', ['B'], []),
    aim('D', ['A', 'B'], []),
  ];
}

test('planSpinOff: worked example — B+C move, D overlaps, A kept', () => {
  const plan = planSpinOff(exampleGraph(), ['B']);
  assert.deepEqual(sorted(plan.copyIds), ['B', 'C', 'D']);
  assert.deepEqual(sorted(plan.spinOffIds), ['B', 'C']); // red: roots + exclusive supporters
  assert.deepEqual(sorted(plan.overlapIds), ['D']); // orange: shared
  assert.deepEqual(sorted(plan.keptIds), ['A']); // green: source-only ancestor
});

test('computeSpinOff: seam edges dropped, shared edges split, phases cleared', () => {
  const res = computeSpinOff(exampleGraph(), ['B']);

  const so = new Map(res.spinOffAims.map((a) => [a.id, a]));
  // B's seam edge B->A is dropped (A not copied); B keeps children C and D.
  assert.deepEqual(so.get('B')!.supportedAims, []);
  assert.deepEqual(sorted(so.get('B')!.supportingConnections.map((c) => c.aimId)), ['C', 'D']);
  // D in the spin-off keeps only D->B (D->A dropped, A not copied).
  assert.deepEqual(so.get('D')!.supportedAims, ['B']);
  // phases are not carried.
  assert.deepEqual(so.get('B')!.committedIn, []);

  // Source: B and C deleted.
  assert.deepEqual(sorted(res.sourceAimIdsToDelete), ['B', 'C']);
  const rewrites = new Map(res.sourceAimsToRewrite.map((a) => [a.id, a]));
  // A loses its child B, keeps D.
  assert.deepEqual(rewrites.get('A')!.supportingConnections.map((c) => c.aimId), ['D']);
  // D (overlap) loses parent B in the source, keeps A.
  assert.deepEqual(rewrites.get('D')!.supportedAims, ['A']);
});

test('conservative: a supporter that also serves an outside aim is kept (overlap), not deleted', () => {
  // A->B->C, and C also supports outside aim E. Export B.
  const aims = [
    aim('A', [], ['B']),
    aim('B', ['A'], ['C']),
    aim('C', ['B', 'E'], []),
    aim('E', [], ['C']),
  ];
  const plan = planSpinOff(aims, ['B']);
  assert.deepEqual(sorted(plan.copyIds), ['B', 'C']);
  assert.deepEqual(sorted(plan.spinOffIds), ['B']); // only the root is removed
  assert.deepEqual(sorted(plan.overlapIds), ['C']); // C shared via E → kept
  assert.deepEqual(sorted(plan.keptIds), ['A', 'E']);
});

test('leaf root: only the root moves', () => {
  const aims = [aim('A', [], ['B']), aim('B', ['A'], [])];
  const plan = planSpinOff(aims, ['B']);
  assert.deepEqual(sorted(plan.copyIds), ['B']);
  assert.deepEqual(sorted(plan.spinOffIds), ['B']);
  assert.deepEqual(plan.overlapIds, []);
  assert.deepEqual(sorted(plan.keptIds), ['A']);
});

test('multiple roots: union of both branches', () => {
  // R1->(X), R2->(X,Y); X shared by both roots, Y exclusive to R2.
  const aims = [
    aim('R1', [], ['X']),
    aim('R2', [], ['X', 'Y']),
    aim('X', ['R1', 'R2'], []),
    aim('Y', ['R2'], []),
  ];
  const plan = planSpinOff(aims, ['R1', 'R2']);
  assert.deepEqual(sorted(plan.copyIds), ['R1', 'R2', 'X', 'Y']);
  // X's parents are both roots (both red) → X red; Y's parent R2 red → red.
  assert.deepEqual(sorted(plan.spinOffIds), ['R1', 'R2', 'X', 'Y']);
  assert.deepEqual(plan.overlapIds, []);
  assert.deepEqual(plan.keptIds, []);
});

test('preserveInflow: external inflow folded into intrinsicValue of the seam aim', () => {
  // A (intrinsic source) -> B -> C. Export B: B's inflow from A (dropped) should
  // be folded into B's intrinsicValue so C still receives weight in the spin-off.
  const aims = [
    { ...aim('A', [], ['B']), intrinsicValue: 10 },
    aim('B', ['A'], ['C']),
    aim('C', ['B'], []),
  ];

  const without = computeSpinOff(aims, ['B']);
  const wB = without.spinOffAims.find((a) => a.id === 'B')!;
  assert.equal(wB.intrinsicValue, 0); // default: no compensation

  const withInflow = computeSpinOff(aims, ['B'], { preserveInflow: true });
  const b = withInflow.spinOffAims.find((a) => a.id === 'B')!;
  // B had no intrinsic of its own but received flow from A; that is now its intrinsic.
  assert.ok(b.intrinsicValue > 0, `expected B to gain intrinsic inflow, got ${b.intrinsicValue}`);
  // C has no external parents (its only parent B is copied) → unchanged.
  const c = withInflow.spinOffAims.find((a) => a.id === 'C')!;
  assert.equal(c.intrinsicValue, 0);
});

test('empty / unknown roots produce an empty plan', () => {
  const plan = planSpinOff(exampleGraph(), ['does-not-exist']);
  assert.deepEqual(plan.copyIds, []);
  assert.deepEqual(plan.spinOffIds, []);
});
