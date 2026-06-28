import test from 'node:test';
import assert from 'node:assert/strict';
import { composeInstructContext } from './watchdog-service';

test('composeInstructContext: no project instructions ⇒ base + memory only, unchanged', () => {
  const out = composeInstructContext({
    baseInstructText: 'GUIDE',
    sessionSummaries: 'SUMMARIES',
    friction: 'FRICTION',
  });
  assert.equal(out, 'GUIDE\n\nSUMMARIES\n\nFRICTION');
  assert.ok(!out.includes('Project instructions'), 'no project block when none given');
});

test('composeInstructContext: project instructions land right after the guide, before memory', () => {
  const out = composeInstructContext({
    baseInstructText: 'GUIDE',
    projectInstructions: 'work directly on main, no PRs',
    sessionSummaries: 'SUMMARIES',
    friction: 'FRICTION',
  });

  const guideIdx = out.indexOf('GUIDE');
  const projIdx = out.indexOf('Project instructions (from the human)');
  const bodyIdx = out.indexOf('work directly on main, no PRs');
  const summIdx = out.indexOf('SUMMARIES');

  assert.ok(projIdx > guideIdx, 'project block follows the guide');
  assert.ok(bodyIdx > projIdx, 'the human text is inside the block');
  assert.ok(summIdx > projIdx, 'session memory comes after the project block');
});

test('composeInstructContext: whitespace-only instructions are ignored', () => {
  const out = composeInstructContext({ baseInstructText: 'GUIDE', projectInstructions: '   \n  ' });
  assert.equal(out, 'GUIDE');
});

test('composeInstructContext: only the base text ⇒ just the guide', () => {
  assert.equal(composeInstructContext({ baseInstructText: 'GUIDE' }), 'GUIDE');
});
