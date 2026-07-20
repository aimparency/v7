import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createExperiment, listExperiments, updateExperiment } from './experiment-state.js';

test('persists experiment evidence and belief updates', async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), 'aimparency-experiments-'));
  try {
    const created = await createExperiment(projectPath, {
      aimIds: ['aim-1'],
      hypothesis: 'A smaller release gets useful feedback sooner.',
      prediction: 'At least one user responds within seven days.',
      expectedCost: '2 engineering days',
      expectedUpside: 'Validated demand',
      successMetric: 'One substantive response',
      stopCondition: 'Stop after seven days without a response',
      status: 'running'
    });

    const updated = await updateExperiment(projectPath, created.id, {
      status: 'succeeded',
      evidence: {
        summary: 'A user requested a follow-up.',
        ref: 'external:message-42',
        observedAt: 123
      },
      result: 'Prediction met.',
      beliefUpdate: {
        previousConfidence: 0.4,
        newConfidence: 0.7,
        reason: 'Observed direct user interest.'
      },
      economicOutcomeRef: 'accounting:project-7',
      nextDecision: 'Run a paid pilot.'
    });

    assert.equal(updated.evidence.length, 1);
    assert.equal(updated.beliefUpdate?.newConfidence, 0.7);
    assert.equal(updated.economicOutcomeRef, 'accounting:project-7');
    assert.deepEqual(await listExperiments(projectPath), [updated]);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
