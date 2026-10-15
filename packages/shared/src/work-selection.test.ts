import { test } from 'node:test';
import assert from 'node:assert';
import type { Idea, Phase } from './types.js';
import { resolveWorkPhase, selectWorkCandidates } from './work-selection.js';

const idea = (id: string, state: string, options: { parents?: string[]; children?: string[]; phase?: string } = {}): Idea => ({
  id,
  text: id,
  status: { state, comment: '', date: 0 },
  supportedIdeas: options.parents ?? [],
  supportingConnections: (options.children ?? []).map((ideaId) => ({ ideaId })),
  committedIn: options.phase ? [options.phase] : []
}) as unknown as Idea;
// Only the fields the selection reads; real records carry many more.
const asPhase = (fields: Partial<Phase>) => ({ name: fields.id, childPhaseIds: [], commitments: [], ...fields }) as Phase;
const phase = (commitments: string[]) => asPhase({ id: 'p', commitments });
const ids = (ideas: Idea[]) => ideas.map((entry) => entry.id).sort();

test('an open idea whose children are blocked or in review is a container, not a leaf', () => {
  const ideas = [
    idea('hub', 'open', { children: ['waiting', 'reviewing', 'doing'], phase: 'p' }),
    idea('waiting', 'human-dependent', { parents: ['hub'] }),
    idea('reviewing', 'review', { parents: ['hub'] }),
    idea('doing', 'in-progress', { parents: ['hub'] })
  ];
  const selection = selectWorkCandidates(ideas, phase(['hub']));
  assert.equal(selection.scope, 'mission-containers-exploration');
  assert.deepEqual(ids(selection.candidates), ['hub']);
});

test('an idea whose children are all settled is a leaf again', () => {
  const ideas = [
    idea('parent', 'open', { children: ['done', 'dropped'], phase: 'p' }),
    idea('done', 'implemented', { parents: ['parent'] }),
    idea('dropped', 'cancelled', { parents: ['parent'] })
  ];
  const selection = selectWorkCandidates(ideas, phase(['parent']));
  assert.equal(selection.scope, 'phase-commitments');
  assert.deepEqual(ids(selection.candidates), ['parent']);
});

test('committed containers are not ranked beside committed leaves', () => {
  const ideas = [
    idea('container', 'open', { children: ['leaf'], phase: 'p' }),
    idea('leaf', 'open', { parents: ['container'], phase: 'p' })
  ];
  assert.deepEqual(ids(selectWorkCandidates(ideas, phase(['container', 'leaf'])).candidates), ['leaf']);
});

test('without committed leaves, open leaves serving a parent anywhere are the work', () => {
  const ideas = [
    idea('container', 'open', { children: ['subtask'], phase: 'p' }),
    idea('subtask', 'open', { parents: ['container'] }),
    idea('orphan', 'open')
  ];
  const selection = selectWorkCandidates(ideas, phase(['container']));
  assert.equal(selection.scope, 'connected-uncommitted-leaves');
  assert.deepEqual(ids(selection.candidates), ['subtask']);
});

test('resolveWorkPhase prefers the requested phase, then the deepest running one with commitments', () => {
  const now = 1000;
  const phases = [
    asPhase({ id: 'year', name: 'year', from: 1, to: 2000, childPhaseIds: ['month'], commitments: ['a'] }),
    asPhase({ id: 'month', name: 'month', from: 500, to: 1500, parent: 'year', commitments: [] }),
    asPhase({ id: 'other', name: 'other', commitments: ['b'] })
  ];
  assert.equal(resolveWorkPhase(phases, 'other', now)?.id, 'other');
  assert.equal(resolveWorkPhase(phases, 'missing', now)?.id, 'year', 'month is empty, so its parent carries the work');
  assert.equal(resolveWorkPhase(phases, null, 3000), null);
});
