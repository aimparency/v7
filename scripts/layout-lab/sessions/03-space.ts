import type { SessionDesign } from '../session.ts'

// Session 2 (ratings/session-20261018-1609.json): the strength floor did
// nothing (all strengths are 0.4–0.6); the combination (pull 3, spacing 3.5,
// outward 0.5, spread 1.5, memory 0.5) beat the defaults on three projects
// and avoided v7's arrow clutter; ideas should keep room between all of
// them, not only connected ones. The lab: a wider minimum space cuts
// crowding, arrow overlap and crossings; the 1/gap curve does not beat a
// constant push there.
const combination = { length: 3, spacing: 3.5, outward: 0.5, spread: 1.5, memory: 0.5 }
export default {
  description: 'Minimum space between all ideas (reach, curve, amount), connection strengths, and the session 2 combination.',
  comparisons: [
    { hypothesis: 'Minimum space 5 beats 3: room between all ideas, not only connected ones', sides: [{ weights: { space: 5 } }, {}] },
    { hypothesis: 'Minimum space 7 beats 5: still more room is still better (or too sparse?)', sides: [{ weights: { space: 7 } }, { weights: { space: 5 } }] },
    { hypothesis: 'Pushing with 1 / gap beats a constant push, at space 5', sides: [{ weights: { space: 5, spaceCurve: 1 } }, { weights: { space: 5 } }] },
    { hypothesis: 'Pushing 4× harder (amount 16) beats amount 4, at space 5', sides: [{ weights: { space: 5, separation: 16 } }, { weights: { space: 5 } }] },
    { hypothesis: 'With space 5, connections can be shorter: spacing 3.5 beats 4', sides: [{ settings: { spacing: 3.5 }, weights: { space: 5 } }, { weights: { space: 5 } }] },
    { hypothesis: 'The session 2 combination with space 5 beats it without', sides: [{ settings: combination, weights: { space: 5 } }, { settings: combination }] },
    { hypothesis: 'Importance at full contrast (uncompressed flow strengths) beats the simulation\'s compressed strengths', sides: [{ strengths: 'flow' }, {}] },
    { hypothesis: 'Strength as the child\'s share (a small idea\'s only connection counts fully) beats the current strengths', sides: [{ strengths: 'child-share' }, {}] },
    { hypothesis: 'Even spread 2.5 beats 1 (unrated in session 2)', sides: [{ settings: { spread: 2.5 } }, {}] },
    { hypothesis: 'Keep as is 0.3 beats 1 (unrated in session 2)', sides: [{ settings: { memory: 0.3 } }, {}] }
  ]
} satisfies SessionDesign
