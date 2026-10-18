import type { Experiment } from '../run.ts'

// More iterations, separation, and the sweep's promising settings combined.
const combined = { settings: { length: 6, semantic: 0, outward: 1.5 }, weights: { separation: 4 } }
export default {
  description: 'More iterations; separation; candidate defaults combined (length 6, semantic 0, outward 1.5, separation 4).',
  seeds: 3,
  runs: [
    { name: 'current' },
    { name: 'budget 2400', relax: { budget: 2400 } },
    { name: 'separation 2', weights: { separation: 2 } },
    { name: 'separation 4', weights: { separation: 4 } },
    { name: 'separation 4, budget 1200', weights: { separation: 4 }, relax: { budget: 1200 } },
    { name: 'combined', ...combined },
    { name: 'combined, budget 1200', ...combined, relax: { budget: 1200 } },
    { name: 'combined, semantic 0.03', ...combined, settings: { ...combined.settings, semantic: 0.03 } },
    { name: 'combined, outward 0.15', ...combined, settings: { ...combined.settings, outward: 0.15 } },
    { name: 'combined, length 2', ...combined, settings: { ...combined.settings, length: 2 } }
  ]
} satisfies Experiment
