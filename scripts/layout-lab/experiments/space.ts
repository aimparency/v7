import type { Experiment } from '../run.ts'

// Minimum space between all ideas: reach (radius sums); importance; session
// 2's preferred combination. (Its curve variants went with the curve
// setting: the push is now 1 / (1 + gap).)
export default {
  description: 'Minimum space: reach; connection strengths.',
  seeds: 1,
  runs: [
    { name: 'space 3', weights: { space: 3 } },
    { name: 'space 4', weights: { space: 4 } },
    { name: 'space 5', weights: { space: 5 } },
    { name: 'space 5, importance 0', settings: { importance: 0 }, weights: { space: 5 } },
    { name: 'space 5, importance 1', settings: { importance: 1 }, weights: { space: 5 } },
    { name: 'session 2 combination', settings: { length: 3, spacing: 3.5, outward: 0.5, spread: 1.5, memory: 0.5 }, weights: { space: 3 } }
  ]
} satisfies Experiment
