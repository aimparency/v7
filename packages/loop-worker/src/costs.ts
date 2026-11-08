import fs from 'fs-extra';
import path from 'path';
import type { HarnessConfig } from 'shared/harness-config';
import type { StageTrace } from './stage-runner.js';
import { tracesDir, type CycleTrace } from './traces.js';

// Actual cost of a cycle in USD, from each stage's token usage and the price of
// the model that ran it. A stage on a model without a price makes the cycle
// unpriced (null) rather than silently cheaper.

export function stageCostUsd(stage: Pick<StageTrace, 'model' | 'usage'>, prices: HarnessConfig['prices']): number | null {
  const price = prices[stage.model.model];
  if (!price) return null;
  return (stage.usage.inputTokens * price.inputPerMTok + stage.usage.outputTokens * price.outputPerMTok) / 1_000_000;
}

export function cycleCostUsd(stages: Pick<StageTrace, 'model' | 'usage'>[], prices: HarnessConfig['prices']): number | null {
  let total = 0;
  for (const stage of stages) {
    const cost = stageCostUsd(stage, prices);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

export function unpricedModels(stages: Pick<StageTrace, 'model'>[], prices: HarnessConfig['prices']): string[] {
  return [...new Set(stages.map((stage) => stage.model.model).filter((model) => !prices[model]))];
}

/** USD spent by priced cycles that started today (UTC), read from the trace store. */
export async function spentTodayUsd(projectPath: string, now = new Date()): Promise<number> {
  const dir = tracesDir(projectPath);
  const today = now.toISOString().slice(0, 10);
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => name.startsWith(today) && name.endsWith('.json'));
  let total = 0;
  for (const file of files) {
    const trace = await fs.readJson(path.join(dir, file)).catch(() => null) as Pick<CycleTrace, 'costUsd'> | null;
    total += trace?.costUsd ?? 0;
  }
  return total;
}

export function tokensUsed(usage: { inputTokens: number; outputTokens: number }): number {
  return usage.inputTokens + usage.outputTokens;
}
