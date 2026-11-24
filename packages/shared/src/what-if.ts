// What a change would do to the space's values and priorities, before it is
// made: the value model run on a changed copy, compared with the current one.
// Nothing is written.

import type { Idea } from './types.js';
import { calculateIdeaValues } from './value-calculation.js';
import { DEFAULT_IDEA_COST } from './constants.js';
import { isOngoingState } from './work-selection.js';

export type WhatIfChange =
  /** The ideas leave the space with their connections, as if deleted. */
  | { kind: 'remove'; ideaIds: string[] }
  /** The connection parent → child carries this weight. */
  | { kind: 'weight'; parentId: string; childId: string; weight: number };

export type WhatIfShift = { id: string; text: string; valueBefore: number; valueAfter: number; priorityBefore: number; priorityAfter: number };

export function applyWhatIf(ideas: Idea[], change: WhatIfChange): Idea[] {
  if (change.kind === 'remove') {
    const gone = new Set(change.ideaIds);
    return ideas
      .filter(idea => !gone.has(idea.id))
      .map(idea => ({
        ...idea,
        supportingConnections: (idea.supportingConnections ?? []).filter(connection => !gone.has(connection.ideaId)),
        supportedIdeas: (idea.supportedIdeas ?? []).filter(id => !gone.has(id))
      }));
  }
  if (!ideas.some(idea => idea.id === change.parentId && idea.supportingConnections?.some(connection => connection.ideaId === change.childId))) {
    throw new Error(`No connection from ${change.parentId} to ${change.childId}.`);
  }
  return ideas.map(idea => idea.id !== change.parentId ? idea : {
    ...idea,
    supportingConnections: idea.supportingConnections.map(connection =>
      connection.ideaId === change.childId ? { ...connection, weight: change.weight } : connection)
  });
}

/**
 * The ideas whose value or priority the change moves, largest relative move
 * first; values in the space's absolute units (share × total intrinsic value).
 */
export function whatIf(ideas: Idea[], change: WhatIfChange, defaultCost = DEFAULT_IDEA_COST): { shifts: WhatIfShift[]; topBefore: string[]; topAfter: string[] } {
  const before = calculateIdeaValues(ideas, defaultCost);
  const after = calculateIdeaValues(applyWhatIf(ideas, change), defaultCost);
  const absolute = (result: typeof before, id: string) => (result.values.get(id) ?? 0) * result.totalIntrinsic;
  const relative = (from: number, to: number) => Math.abs(to - from) / Math.max(Math.abs(from), Math.abs(to), 1e-12);
  const shifts = ideas
    .map(idea => ({
      id: idea.id,
      text: idea.text,
      valueBefore: absolute(before, idea.id),
      valueAfter: absolute(after, idea.id),
      priorityBefore: before.priorities.get(idea.id) ?? 0,
      priorityAfter: after.priorities.get(idea.id) ?? 0
    }))
    .filter(shift => relative(shift.valueBefore, shift.valueAfter) > 1e-6 || relative(shift.priorityBefore, shift.priorityAfter) > 1e-6)
    .sort((left, right) =>
      Math.max(relative(right.valueBefore, right.valueAfter), relative(right.priorityBefore, right.priorityAfter))
      - Math.max(relative(left.valueBefore, left.valueAfter), relative(left.priorityBefore, left.priorityAfter)));
  // The top of the ranking: open work only, as get_prioritized_ideas ranks it.
  const ongoing = new Set(ideas.filter(idea => isOngoingState(idea.status?.state)).map(idea => idea.id));
  const top = (result: typeof before) => [...result.priorities].filter(([id]) => ongoing.has(id))
    .sort((left, right) => right[1] - left[1]).slice(0, 5).map(([id]) => id);
  return { shifts, topBefore: top(before), topAfter: top(after) };
}
