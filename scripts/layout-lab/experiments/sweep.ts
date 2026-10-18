import { DEFAULT_LAYOUT_SETTINGS } from '../../../packages/frontend/src/utils/autolayout.ts'
import type { Experiment } from '../run.ts'

// One slider at a time, the others at their defaults: where does each stop
// mattering, where does it start breaking things?
const FACTORS = [0, 0.1, 0.3, 3, 10]
const weights = ['memory', 'length', 'spread', 'outward', 'semantic', 'isolatedSemantic'] as const

export default {
  description: 'Each weight off and at 0.1×–10× its default, spacing 3–5; everything else at the defaults.',
  seeds: 2,
  runs: [
    { name: 'defaults' },
    ...weights.flatMap(key => FACTORS.map(factor => ({ name: `${key} ×${factor}`, settings: { [key]: DEFAULT_LAYOUT_SETTINGS[key] * factor } }))),
    ...[3, 3.5, 4.5, 5].map(spacing => ({ name: `spacing ${spacing}`, settings: { spacing } }))
  ]
} satisfies Experiment
