import type { Experiment } from '../run.ts'

// Minimum space between all ideas: reach (radius sums), curve (0 constant,
// 1 with 1 / gap), amount (separation); importance; session 2's preferred
// combination.
export default {
  description: 'Minimum space: reach × curve × amount; connection strengths.',
  seeds: 1,
  runs: [
    { name: 'space 3, constant', weights: { space: 3 } },
    { name: 'space 3, 1/gap', weights: { space: 3, spaceCurve: 1 } },
    { name: 'space 4, constant', weights: { space: 4 } },
    { name: 'space 4, 1/gap', weights: { space: 4, spaceCurve: 1 } },
    { name: 'space 5, constant', weights: { space: 5 } },
    { name: 'space 5, 1/gap', weights: { space: 5, spaceCurve: 1 } },
    { name: 'space 5, 1/gap²', weights: { space: 5, spaceCurve: 2 } },
    { name: 'space 7, 1/gap', weights: { space: 7, spaceCurve: 1 } },
    { name: 'space 5, 1/gap, amount 1', weights: { space: 5, spaceCurve: 1, separation: 1 } },
    { name: 'space 5, 1/gap, amount 16', weights: { space: 5, spaceCurve: 1, separation: 16 } },
    { name: 'space 5, importance 0', settings: { importance: 0 }, weights: { space: 5 } },
    { name: 'space 5, importance 1', settings: { importance: 1 }, weights: { space: 5 } },
    { name: 'session 2 combination', settings: { length: 3, spacing: 3.5, outward: 0.5, spread: 1.5, memory: 0.5 }, weights: { space: 3 } },
    { name: 'combination, space 5, 1/gap', settings: { length: 3, spacing: 3.5, outward: 0.5, spread: 1.5, memory: 0.5 }, weights: { space: 5, spaceCurve: 1 } }
  ]
} satisfies Experiment
