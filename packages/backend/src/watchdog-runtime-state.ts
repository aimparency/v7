import { z } from 'zod'

export const watchdogAgentTypeSchema = z.enum(['claude', 'gemini', 'codex', 'agy', 'grok'])

const authorityAuditEntrySchema = z.object({
  timestamp: z.number().finite().nonnegative(),
  actionType: z.string().min(1).max(64),
  disposition: z.enum(['execute', 'refuse', 'escalate', 'stop']),
  reasons: z.array(z.string().min(1).max(64)).max(8),
})

export const watchdogSupervisorStateSchema = z.object({
  state: z.string().min(1).max(64),
  color: z.string().min(1).max(32),
  authorityAudit: z.array(authorityAuditEntrySchema)
    .transform(entries => entries.slice(-50))
    .optional(),
})

export const watchdogRuntimeAgentStateSchema = z.object({
  enabled: z.boolean().default(false),
  emergencyStopped: z.boolean().default(false),
  stopReason: z.string().nullable().default(null),
  updatedAt: z.number().default(0),
  supervisorState: watchdogSupervisorStateSchema.nullable().optional(),
})

export const watchdogRuntimeStateSchema = z.object({
  updatedAt: z.number().default(0),
  preferredAgentType: watchdogAgentTypeSchema.nullable().optional(),
  agents: z.record(z.string(), watchdogRuntimeAgentStateSchema).default({}),
})

type RuntimeAgentState = z.infer<typeof watchdogRuntimeAgentStateSchema>

export function mergeWatchdogAgentControlState(
  current: RuntimeAgentState,
  update: Partial<Pick<RuntimeAgentState, 'enabled' | 'emergencyStopped' | 'stopReason'>>,
  updatedAt: number,
): RuntimeAgentState {
  return watchdogRuntimeAgentStateSchema.parse({
    ...current,
    enabled: update.enabled ?? current.enabled,
    emergencyStopped: update.emergencyStopped ?? current.emergencyStopped,
    stopReason: update.stopReason !== undefined ? update.stopReason : current.stopReason,
    updatedAt,
  })
}
