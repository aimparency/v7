import { describe, expect, it } from 'vitest'
import {
  mergeWatchdogAgentControlState,
  watchdogRuntimeAgentStateSchema,
} from './watchdog-runtime-state.js'

const entry = (timestamp: number) => ({
  timestamp,
  actionType: 'start_work',
  disposition: 'execute' as const,
  reasons: ['authorized_bounded_action'],
  payload: 'must be stripped',
})

describe('watchdog runtime authority audit', () => {
  it('preserves supervisor state while merging unrelated control fields', () => {
    const current = watchdogRuntimeAgentStateSchema.parse({
      enabled: true,
      emergencyStopped: false,
      stopReason: null,
      updatedAt: 1,
      supervisorState: {
        state: 'WORKING',
        color: '#abc123',
        authorityAudit: [entry(10)],
      },
    })

    const merged = mergeWatchdogAgentControlState(current, { enabled: false }, 20)

    expect(merged.enabled).toBe(false)
    expect(merged.updatedAt).toBe(20)
    expect(merged.supervisorState?.state).toBe('WORKING')
    expect(merged.supervisorState?.authorityAudit).toEqual([{
      timestamp: 10,
      actionType: 'start_work',
      disposition: 'execute',
      reasons: ['authorized_bounded_action'],
    }])
    expect(JSON.stringify(merged)).not.toContain('must be stripped')
  })

  it('retains only the newest fifty authority entries', () => {
    const parsed = watchdogRuntimeAgentStateSchema.parse({
      supervisorState: {
        state: 'EXPLORING',
        color: '#ffffff',
        authorityAudit: Array.from({ length: 55 }, (_, index) => entry(index)),
      },
    })

    expect(parsed.supervisorState?.authorityAudit).toHaveLength(50)
    expect(parsed.supervisorState?.authorityAudit?.[0].timestamp).toBe(5)
    expect(parsed.supervisorState?.authorityAudit?.[49].timestamp).toBe(54)
  })
})
