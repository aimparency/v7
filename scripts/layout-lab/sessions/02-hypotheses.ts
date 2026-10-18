import type { SessionDesign } from '../session.ts'

// From the first session: overlaps and children bunched on one side of their
// parent are the worst; too sparse and very long weak connections are bad
// too; rounder graphs look good. Each comparison tests one hypothesis
// against the current defaults (the second side).
export default {
  description: 'Hypotheses from the first session, each against the defaults.',
  comparisons: [
    { hypothesis: 'Pull to spacing 3 beats 6: a weaker pull bunches children less and still keeps the graph compact', sides: [{ settings: { length: 3 } }, {}] },
    { hypothesis: 'Spacing 3.5 beats 4: denser is nicer (3.1 beat 6.8)', sides: [{ settings: { spacing: 3.5 } }, {}] },
    { hypothesis: 'Outward 0.4 beats 1.5: the default already streams the graph in one direction', sides: [{ settings: { outward: 0.4 } }, {}] },
    { hypothesis: 'Even spread 2.5 beats 1: rounder, and weak connections do not fly out yet (they did at 5.6)', sides: [{ settings: { spread: 2.5 } }, {}] },
    { hypothesis: 'A strength floor of 0.3 for the length pull keeps weak connections shorter without bunching', sides: [{ weights: { strengthFloor: 0.3 } }, {}] },
    { hypothesis: 'With the strength floor, even spread 5 keeps its roundness without the long weak connections', sides: [{ settings: { spread: 5 }, weights: { strengthFloor: 0.3 } }, { settings: { spread: 5 } }] },
    { hypothesis: 'Keep as is 0.3 beats 1 (0.15 beat 10)', sides: [{ settings: { memory: 0.3 } }, {}] },
    { hypothesis: 'Separation 8 beats 4: the metrics preferred 4 for crossings, but overlaps matter more to the eye', sides: [{ weights: { separation: 8 } }, {}] },
    { hypothesis: 'All of the above together beat the defaults', sides: [{ settings: { length: 3, spacing: 3.5, outward: 0.5, spread: 1.5, memory: 0.5 }, weights: { strengthFloor: 0.3 } }, {}] },
    { hypothesis: 'Control: practically the same settings (pull to spacing 6 vs 6.2); expect "same" or random picks', sides: [{ settings: { length: 6.2 } }, {}] }
  ]
} satisfies SessionDesign
