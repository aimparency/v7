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

  assert.strictEqual(priorityA, 2, 'Priority A should be 2');
  assert.strictEqual(priorityB, 2.5, 'Priority B should be 2.5');
});
