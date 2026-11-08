import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { toBowmanPath } from './project-path.js';

// The harness configuration lives in .bowman/harness.json, versioned with the
// graph and edited by LLMs or by hand. The loop-worker reads it at the start of
// every cycle, so a change takes effect on the next cycle without a restart.
// Every field has a default: a missing file means the defaults.

const stepBudget = z.number().int().min(1).max(100);

export const harnessConfigSchema = z.object({
  /** Model steps per stage (tool calls plus the final submit call). */
  stepBudgets: z.object({
    decompose: stepBudget.default(8),
    execute: stepBudget.default(20),
    verify: stepBudget.default(10),
    reflect: stepBudget.default(2)
  }).default({}),
  /** Characters of compiled context per stage (roughly 4 per token). */
  contextBudgetChars: z.number().int().min(2000).default(48_000),
  decomposition: z.object({
    maxChildren: z.number().int().min(1).max(7).default(7),
    /** Where new children land; ai-proposition waits for a human to accept them. */
    landingState: z.enum(['open', 'ai-proposition']).default('open')
  }).default({}),
  receipts: z.object({
    /** Claimed commands the harness re-runs before verification. */
    maxCommands: z.number().int().min(0).max(20).default(5),
    timeoutMs: z.number().int().min(1000).max(600_000).default(120_000)
  }).default({})
}).strict();

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;
export type LoadedHarnessConfig = { config: HarnessConfig; version: string };

export const getHarnessConfigPath = (projectPath: string) => path.join(toBowmanPath(path.resolve(projectPath)), 'harness.json');

/**
 * Reads the config with defaults filled in. `version` is a short hash of the
 * file (or "defaults"), recorded in traces so cycles can be compared by config.
 * An invalid file throws: running a cycle on a half-applied config would hide the mistake.
 */
export function loadHarnessConfig(projectPath: string): LoadedHarnessConfig {
  const file = getHarnessConfigPath(projectPath);
  if (!fs.existsSync(file)) return { config: harnessConfigSchema.parse({}), version: 'defaults' };
  const text = fs.readFileSync(file, 'utf8');
  const parsed = harnessConfigSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`Invalid ${file}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  return { config: parsed.data, version: createHash('sha256').update(text).digest('hex').slice(0, 12) };
}
