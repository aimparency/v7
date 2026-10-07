const processEnv =
  typeof globalThis !== 'undefined' && 'process' in globalThis
    ? (globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> }
      }).process?.env
    : undefined

// Version of the .bowman storage format, kept in meta.json as dataModelVersion.
// Bump it together with a new entry in bowman-migration.ts (Node-only).
export const CURRENT_DATA_MODEL_VERSION = 4;

// Cost of an idea created without an explicit estimate, unless the project
// sets meta.defaultCost. Cost is always positive: everything costs something.
export const DEFAULT_IDEA_COST = 1;

export function defaultIdeaCost(meta?: { defaultCost?: unknown } | null): number {
  const cost = meta?.defaultCost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : DEFAULT_IDEA_COST;
}

export const AIMPARENCY_DIR_NAME = processEnv?.AIMPARENCY_DIR_NAME
  ? processEnv.AIMPARENCY_DIR_NAME
  : '.bowman';

export interface IdeaState {
  key: string;
  color: string;
  ongoing: boolean;
  promptsEvaluation?: boolean;
}

export const INITIAL_STATES: IdeaState[] = [
  { key: 'open', color: '#ffcc80', ongoing: true },
  { key: 'in-progress', color: '#f6d32d', ongoing: true },
  { key: 'partially', color: '#fff176', ongoing: true },
  { key: 'review', color: '#64b5f6', ongoing: true },
  { key: 'implemented', color: '#81c784', ongoing: false, promptsEvaluation: true },
  { key: 'halted', color: '#9e9e9e', ongoing: false },
  { key: 'cancelled', color: '#e57373', ongoing: false, promptsEvaluation: true },
  { key: 'failed', color: '#ba68c8', ongoing: false, promptsEvaluation: true },
  { key: 'unclear', color: '#90a4ae', ongoing: false },
  { key: 'human-dependent', color: '#bf409f', ongoing: true }
];


// Cost of capital / discount rates
export const DISCOUNT_RATE = 0.05; // 5% discount per cost unit (legacy, for backward compat)
export const ANNUAL_DISCOUNT_RATE = 0.10; // 10% annual discount rate (cost of capital)
export const DAILY_DISCOUNT_RATE = Math.pow(1 + ANNUAL_DISCOUNT_RATE, 1/365) - 1; // ~0.026% per day
