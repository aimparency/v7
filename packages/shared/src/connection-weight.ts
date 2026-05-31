// Contribution-share <-> connection-weight math.
//
// A supporting connection's *contribution share* is how much of the supported
// aim's (parent's) value flows through it. The value engine
// (value-calculation.ts) normalizes each child by the parent's total outflow:
//
//     share_i = weight_i / (Σ siblingWeights + effectiveLoopWeight)
//
// So a connection's share depends on the sum of its sibling weights (S) and the
// parent's loop weight (L), not just its own weight. These helpers convert
// between an intended share and the weight that achieves it, and pick a sane
// default weight for a freshly-created connection.

/** Maximum share a single connection may claim when other flow (siblings or
 *  loop) already exists. 100% is unreachable in that case (it needs w→∞), so we
 *  cap the UI input here. */
export const MAX_SHARE = 0.9;

/** Resulting share of a connection with weight `w`, given sibling-weight sum `S`
 *  and effective loop weight `L`. */
export function weightToShare(w: number, S: number, L: number): number {
  const total = S + L + w;
  return total > 0 ? w / total : 0;
}

/** Weight needed for a connection to claim share `p`, given sibling-weight sum
 *  `S` and effective loop weight `L`.
 *  When `S + L === 0` any positive weight yields 100%, so we return 1.
 *  `p` is clamped to `[0, MAX_SHARE]` to stay in the reachable range. */
export function shareToWeight(p: number, S: number, L: number): number {
  const base = S + L;
  if (base <= 0) return 1;
  const share = clampShare(p);
  if (share <= 0) return 0;
  return (share * base) / (1 - share);
}

/** Default weight for a new connection: the average participant size, so the
 *  new connection enters on equal footing with existing siblings/loop.
 *  `siblingCount` is the number of pre-existing sibling connections.
 *  When `S + L === 0` (sole supporter, no loop) the connection gets 100% → 1. */
export function defaultWeight(S: number, L: number, siblingCount: number): number {
  const base = S + L;
  if (base <= 0) return 1;
  const participants = siblingCount + (L > 0 ? 1 : 0);
  return participants > 0 ? base / participants : base;
}

/** Clamp an intended share into the reachable, displayable range. */
export function clampShare(p: number): number {
  if (Number.isNaN(p)) return 0;
  if (p < 0) return 0;
  if (p > MAX_SHARE) return MAX_SHARE;
  return p;
}

/** True when 100% is achievable — i.e. there is no other outgoing flow, so the
 *  share UI can be skipped and the weight defaulted to 1. */
export function isSoleContributor(S: number, L: number): boolean {
  return S + L <= 0;
}
