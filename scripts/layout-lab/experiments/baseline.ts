import type { Experiment } from '../run.ts'

// The current defaults, to see the noise between seeds.
export default {
  description: 'Current defaults; seeds jitter the stored offsets by 0.02 radius sums.',
  seeds: 5,
  runs: [{ name: 'defaults' }]
} satisfies Experiment
