import type { AimStatusState } from 'shared'

/**
 * Single source of truth for default values when creating a new aim.
 * Used by AimCreationModal and UI store to ensure consistency.
 */
export const AIM_DEFAULTS = {
  text: '',
  description: '',
  tags: [] as string[],
  intrinsicValue: 0,
  cost: 1,
  loopWeight: 1,
  duration: 1, // Default 1 day
  costVariance: 0,
  valueVariance: 0,
  status: {
    state: 'open' as AimStatusState,
    comment: ''
  }
}

/**
 * Helper to get a fresh copy of defaults (to avoid mutation)
 */
export function getNewAimDefaults() {
  return {
    text: AIM_DEFAULTS.text,
    description: AIM_DEFAULTS.description,
    tags: [...AIM_DEFAULTS.tags],
    intrinsicValue: AIM_DEFAULTS.intrinsicValue,
    cost: AIM_DEFAULTS.cost,
    loopWeight: AIM_DEFAULTS.loopWeight,
    duration: AIM_DEFAULTS.duration,
    costVariance: AIM_DEFAULTS.costVariance,
    valueVariance: AIM_DEFAULTS.valueVariance,
    status: {
      state: AIM_DEFAULTS.status.state,
      comment: AIM_DEFAULTS.status.comment
    }
  }
}
