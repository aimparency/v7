import type { Experiment } from '../run.ts'

// How much of the solution to apply: the fader's default. Partial
// application moves some subtrees and not their neighbours.
const SHARES = [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1]
const combined = { settings: { length: 6, semantic: 0, outward: 1.5 }, weights: { separation: 4 } }
export default {
  description: 'Shares of the changes applied (shown view), current defaults and the combined candidate.',
  seeds: 2,
  runs: [
    ...SHARES.map(shownShare => ({ name: `current ${shownShare * 100}%`, shownShare })),
    ...SHARES.map(shownShare => ({ name: `combined ${shownShare * 100}%`, shownShare, ...combined }))
  ]
} satisfies Experiment
