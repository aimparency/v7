import type { SessionDesign } from '../session.ts'

// The first session (rated 2026-10-18, ratings/session-20261018-1527.json):
// one setting from far below to far above its slider range, the rest at the
// defaults, and three all-random settings against the defaults.
export default {
  description: 'Each setting at its extremes, to see which ends are acceptable at all.',
  comparisons: [
    { hypothesis: 'Pull to spacing: low vs high', sides: [{ settings: { length: 1.6 } }, { settings: { length: 52 } }] },
    { hypothesis: 'All random vs defaults', sides: [{ settings: { memory: 0.81, length: 0.65, spread: 0.059, outward: 0.23, semantic: 0.089, isolatedSemantic: 0.16 } }, {}] },
    { hypothesis: 'Similar together: off vs on', sides: [{}, { settings: { semantic: 0.11 } }] },
    { hypothesis: 'All random vs defaults', sides: [{}, { settings: { spacing: 3.6, memory: 5, length: 17, spread: 4.1, outward: 0.82, isolatedSemantic: 14 } }] },
    { hypothesis: 'Unconnected toward similar: high vs low', sides: [{ settings: { isolatedSemantic: 7.7 } }, { settings: { isolatedSemantic: 0.12 } }] },
    { hypothesis: 'Keep as is: low vs high', sides: [{ settings: { memory: 0.15 } }, { settings: { memory: 10 } }] },
    { hypothesis: 'Even spread: low vs high', sides: [{ settings: { spread: 0.11 } }, { settings: { spread: 5.6 } }] },
    { hypothesis: 'All random vs defaults', sides: [{}, { settings: { spacing: 4.5, memory: 0.11, length: 8.6, spread: 0.031, outward: 0.083, semantic: 0.0049 } }] },
    { hypothesis: 'Outward: high vs low', sides: [{ settings: { outward: 20 } }, { settings: { outward: 0.26 } }] },
    { hypothesis: 'Spacing: high vs low', sides: [{ settings: { spacing: 6.8 } }, { settings: { spacing: 3.1 } }] }
  ]
} satisfies SessionDesign
