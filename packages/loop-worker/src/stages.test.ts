import assert from 'node:assert/strict';
import test from 'node:test';
import type { Idea } from 'shared';
import { formatReflection, nextStage, statusAfter, workStageFor, type Execution } from './stages.js';

const idea = (id: string, state: string, childIds: string[] = []) => ({
  id,
  text: id,
  status: { state, comment: '', date: 0 },
  supportingConnections: childIds.map((ideaId) => ({ ideaId, relativePosition: [0, 0], weight: 1 })),
  supportedIdeas: []
}) as unknown as Idea;

const execution = (outcome: Execution['outcome']): Execution => ({ outcome, summary: 'did it', evidence: 'tests 3/3', commands: ['pnpm test'] });

test('an open leaf is executed, an idea with ongoing children is decomposed', () => {
  const ideas = [idea('leaf', 'open'), idea('done-child', 'implemented'), idea('parent', 'open', ['done-child']), idea('container', 'open', ['leaf'])];
  const byId = new Map(ideas.map((entry) => [entry.id, entry]));
  assert.equal(workStageFor(byId.get('leaf')!, byId), 'execute');
  assert.equal(workStageFor(byId.get('parent')!, byId), 'execute', 'settled children do not make a container');
  assert.equal(workStageFor(byId.get('container')!, byId), 'decompose');
});

test('stage transitions: done work is verified, verified work is reflected, too-large work is decomposed once', () => {
  assert.equal(nextStage({ stage: 'orient', work: 'execute' }, false), 'execute');
  assert.equal(nextStage({ stage: 'orient', work: 'decompose' }, false), 'decompose');
  assert.equal(nextStage({ stage: 'decompose', result: null }, true), 'record');
  assert.equal(nextStage({ stage: 'execute', result: execution('done') }, false), 'verify');
  assert.equal(nextStage({ stage: 'execute', result: execution('too_large') }, false), 'decompose');
  assert.equal(nextStage({ stage: 'execute', result: execution('too_large') }, true), 'record');
  assert.equal(nextStage({ stage: 'execute', result: execution('blocked') }, false), 'record');
  assert.equal(nextStage({ stage: 'execute', result: null }, false), 'record');
  assert.equal(nextStage({ stage: 'verify', result: { verdict: 'verified', reasons: '' } }, false), 'reflect');
  assert.equal(nextStage({ stage: 'verify', result: { verdict: 'failed', reasons: '' } }, false), 'record');
  assert.equal(nextStage({ stage: 'reflect' }, false), 'record');
});

test('the verdict decides the status: verified → implemented, failed → open with the objection, unverifiable → review', () => {
  const verified = statusAfter(execution('done'), { verdict: 'verified', reasons: 're-ran pnpm test' });
  assert.equal(verified?.state, 'implemented');
  assert.match(verified!.comment, /tests 3\/3[\s\S]*re-ran pnpm test/);
  const failed = statusAfter(execution('done'), { verdict: 'failed', reasons: 'test 2 fails' });
  assert.equal(failed?.state, 'open');
  assert.match(failed!.comment, /test 2 fails/);
  assert.equal(statusAfter(execution('done'), { verdict: 'unverifiable', reasons: 'needs a browser' })?.state, 'review');
  assert.equal(statusAfter(execution('blocked'), null)?.state, 'human-dependent');
  assert.equal(statusAfter(execution('no_progress'), null), null);
  assert.equal(statusAfter(null, null), null);
});

test('a reflection starts with whether the hypothesis held', () => {
  assert.equal(formatReflection({ parentId: 'p', held: 'did_not_hold', reflection: 'no effect on recall' }), 'Did not hold: no effect on recall');
});
