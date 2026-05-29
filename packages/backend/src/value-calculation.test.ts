import { describe, it, expect } from 'vitest';
import { calculateAimValues } from 'shared';
import type { Aim } from 'shared';

describe('calculateAimValues', () => {
  it('distributes value and aggregates costs across a simple parent-child tree', () => {
    const aims: Aim[] = [
      {
        id: 'root',
        text: 'Root',
        status: { state: 'open', comment: '', date: 0 },
        intrinsicValue: 100,
        cost: 1,
        supportingConnections: [
          { aimId: 'child1', weight: 1, relativePosition: [0, 0] },
          { aimId: 'child2', weight: 1, relativePosition: [0, 0] }
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

    expect(result.values.get('root')!).toBeGreaterThan(0);
    expect(result.values.get('child1')!).toBeGreaterThan(0);
    expect(result.values.get('child2')!).toBeGreaterThan(0);

    expect(result.costs.get('root')!).toBeCloseTo(6, 2);
    expect(result.costs.get('child1')!).toBeCloseTo(2, 2);
    expect(result.costs.get('child2')!).toBeCloseTo(3, 2);
  });
});
