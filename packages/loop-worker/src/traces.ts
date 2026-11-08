import fs from 'fs-extra';
import path from 'path';
import type { LoopDefinition } from 'agent-tools';
import { toBowmanPath } from 'shared';
import type { LoadedHarnessConfig } from 'shared/harness-config';
import type { StageTrace, StageUsage } from './stage-runner.js';
import type { Receipt, StatusChange } from './stages.js';

// Per-cycle traces under .bowman/runtime/traces (gitignored): the loop config,
// every stage's compiled context, tool calls and result, the diff the verifier
// saw, and the status the harness wrote. Enough to replay a stage with another
// model or config, and to measure whether context changed a decision.

export const MAX_TRACES = 200;

export type CycleTrace = {
  instanceId: string;
  startedAt: number;
  finishedAt: number;
  ideaId: string;
  ideaText: string;
  loop: Pick<LoopDefinition, 'id' | 'name' | 'provider' | 'model' | 'baseUrl' | 'roles' | 'capabilities' | 'systemPrompt'>;
  harnessConfig: LoadedHarnessConfig;
  stages: StageTrace[];
  verifiedDiff?: { status: string; diff: string };
  receipts: Receipt[];
  statusChange: StatusChange | null;
  notes: string[];
  usage: StageUsage;
  /** null when a stage ran on a model without a price in harness.json. */
  costUsd: number | null;
};

export const tracesDir = (projectPath: string) => path.join(toBowmanPath(path.resolve(projectPath)), 'runtime', 'traces');

/** Writes the trace and keeps only the newest MAX_TRACES. Returns the file path. */
export async function writeCycleTrace(projectPath: string, trace: CycleTrace, maxTraces = MAX_TRACES): Promise<string> {
  const dir = tracesDir(projectPath);
  await fs.ensureDir(dir);
  const stamp = new Date(trace.startedAt).toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${trace.ideaId.slice(0, 8)}.json`);
  await fs.writeJson(file, trace, { spaces: 2 });
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - maxTraces))) {
    await fs.remove(path.join(dir, old));
  }
  return file;
}
