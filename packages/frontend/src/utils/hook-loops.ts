import type { trpc } from '../trpc'

export type HookState = Awaited<ReturnType<typeof trpc.continueHook.get.query>>
export type HookLoop = HookState['loops'][number]

export const NO_HOOK_STATE: HookState = { installed: false, enabled: false, loop: null, loops: [] }

export const DEFAULT_LOOP = 'default'

export const HOOK_AGENTS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'agy', label: 'Antigravity' }
] as const
export type HookAgent = typeof HOOK_AGENTS[number]['id']
