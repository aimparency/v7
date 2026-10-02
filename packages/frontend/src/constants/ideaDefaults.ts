import { DEFAULT_IDEA_COST, type IdeaStatusState } from 'shared'

/**
 * Single source of truth for default values when creating a new idea.
 * Used by IdeaCreationModal and UI store to ensure consistency.
 */
export const IDEA_DEFAULTS = {
  text: '',
  description: '',
  tags: [] as string[],
  intrinsicValue: 0,
  valueRationale: '',
  cost: DEFAULT_IDEA_COST, // projects may override it: dataStore.defaultCost
  loopWeight: 1,
  duration: 1, // Default 1 day
  costVariance: 0,
  valueVariance: 0,
  status: {
    state: 'open' as IdeaStatusState,
    comment: ''
  }
}

/**
 * Helper to get a fresh copy of defaults (to avoid mutation)
 */
export function getNewIdeaDefaults() {
  return {
    text: IDEA_DEFAULTS.text,
    description: IDEA_DEFAULTS.description,
    tags: [...IDEA_DEFAULTS.tags],
    intrinsicValue: IDEA_DEFAULTS.intrinsicValue,
    valueRationale: IDEA_DEFAULTS.valueRationale,
    cost: IDEA_DEFAULTS.cost,
    loopWeight: IDEA_DEFAULTS.loopWeight,
    duration: IDEA_DEFAULTS.duration,
    costVariance: IDEA_DEFAULTS.costVariance,
    valueVariance: IDEA_DEFAULTS.valueVariance,
    status: {
      state: IDEA_DEFAULTS.status.state,
      comment: IDEA_DEFAULTS.status.comment
    }
  }
}
