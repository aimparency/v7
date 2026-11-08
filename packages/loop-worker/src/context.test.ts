import assert from 'node:assert/strict';
import test from 'node:test';
import type { Idea } from 'shared';
import { compileContext, type ContextInput } from './context.js';

type Edge = { ideaId: string; hypothesis?: string; reflection?: string };
const idea = (id: string, state: string, children: Edge[] = [], parents: string[] = [], comment = '') => ({
  id: id.padEnd(8, '0'),
  text: `${id} text`,
  description: `${id} description`,
  status: { state, comment, date: 0 },
  supportingConnections: children.map((child) => ({ ...child, ideaId: child.ideaId.padEnd(8, '0'), relativePosition: [0, 0], weight: 1 })),
  supportedIdeas: parents.map((parent) => parent.padEnd(8, '0'))
}) as unknown as Idea;

function graph(): ContextInput {
  const ideas = [
    idea('root', 'open', [{ ideaId: 'mission', hypothesis: 'mission serves root' }]),
    idea('mission', 'open', [{ ideaId: 'target', hypothesis: 'target speeds up the mission' }, { ideaId: 'sibling' }], ['root']),
    idea('target', 'open', [{ ideaId: 'child', hypothesis: 'child is a step', reflection: 'Held: it was' }], ['mission']),
    idea('child', 'implemented', [], ['target']),
    idea('sibling', 'partially', [], ['mission']),
    idea('dead', 'cancelled', [], ['other'], 'tried it, users did not care'),
    idea('other', 'open', [{ ideaId: 'cousin', hypothesis: 'cousin bet', reflection: 'Did not hold: no effect' }, { ideaId: 'dead' }]),
    idea('cousin', 'implemented', [], ['other'])
  ];
  const ideaById = new Map(ideas.map((entry) => [entry.id, entry]));
  return {
    idea: ideaById.get('target00')!,
    ideaById,
    missionPath: ['root0000', 'mission0'],
    similarIds: ['cousin00', 'dead0000', 'target00'],
    recentEvents: ['status: last cycle verified something'],
    humanMessages: ['Human: focus on speed'],
    facts: { phase: 'Now' }
  };
}

test('the compiled context carries the bets: mission path hypotheses, parent bet, children outcomes, lessons and cancelled reasons', () => {
  const { text, dropped } = compileContext(graph(), 'execute', 48_000);
  assert.deepEqual(dropped, []);
  assert.match(text, /## idea\ntarget text[\s\S]*phase: Now[\s\S]*bet on parent "mission text": target speeds up the mission/);
  assert.match(text, /## mission path\n- root text\n  - mission text\n    because: mission serves root/);
  assert.match(text, /## children\n- \[implemented\] child text[\s\S]*bet: child is a step\n  outcome: Held: it was/);
  assert.match(text, /## cancelled or failed lookalikes\n- \[cancelled\] dead text \(dead0000\)\n  reason: tried it, users did not care/);
  assert.match(text, /## lessons from similar ideas\n- "cousin text" for "other text"\n  bet: cousin bet\n  outcome: Did not hold: no effect/);
  assert.match(text, /## siblings\n- \[partially\] sibling text/);
  assert.ok(!/## similar ideas[\s\S]*target text \(target00\)/.test(text), 'the idea itself is not its own similar idea');
});

test('stages rank sections differently, and the budget cuts the crossing section and drops the rest', () => {
  const input = graph();
  const order = (stage: 'decompose' | 'execute') => compileContext(input, stage, 48_000).included;
  assert.ok(order('decompose').indexOf('siblings') < order('decompose').indexOf('recent loop events'));
  assert.ok(order('execute').indexOf('siblings') > order('execute').indexOf('recent loop events'));

  const small = compileContext(input, 'execute', 700);
  assert.ok(small.chars <= 700, `${small.chars} chars`);
  assert.equal(small.included[0], 'idea');
  assert.ok(small.included.some((name) => name.endsWith('(cut)')) || small.dropped.length > 0);
  assert.ok(small.dropped.includes('siblings'));
});
