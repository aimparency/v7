import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { tracesDir, writeCycleTrace, type CycleTrace } from './traces.js';

test('traces are named by start time and idea, and only the newest are kept', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'traces-'));
  const trace = (startedAt: number) => ({ startedAt, ideaId: 'abcdef12-3456', stages: [] }) as unknown as CycleTrace;
  for (const startedAt of [3, 1, 2, 4].map((day) => Date.UTC(2026, 10, day))) {
    await writeCycleTrace(projectPath, trace(startedAt), 2);
  }
  const files = (await fs.readdir(tracesDir(projectPath))).sort();
  assert.deepEqual(files, ['2026-11-03T00-00-00-000Z-abcdef12.json', '2026-11-04T00-00-00-000Z-abcdef12.json']);
});
