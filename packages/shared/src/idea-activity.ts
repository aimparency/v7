// Live activity on ideas, for watching agents work on the graph. Each kind of
// access fades with its own half-life and glows in its own color; the graph's
// Activity color mode blends them. Accesses add up: an idea read five times in
// a minute glows brighter than one read once.

export const IDEA_ACCESS_KINDS = {
  // An agent's search, list or prioritization result included the idea.
  found: { halfLifeMs: 5 * 60_000, weight: 0.3, color: [0.25, 0.45, 1] },
  // Shown around an idea an agent read (its parents and children).
  contextRead: { halfLifeMs: 5 * 60_000, weight: 0.3, color: [0.25, 0.45, 1] },
  // An agent read the idea itself.
  read: { halfLifeMs: 15 * 60_000, weight: 0.8, color: [0.3, 0.7, 1] },
  // An agent changed the idea (text, description, connections, …).
  write: { halfLifeMs: 60 * 60_000, weight: 1, color: [1, 0.65, 0.15] },
  // An agent changed the idea's status.
  statusChange: { halfLifeMs: 6 * 60 * 60_000, weight: 1, color: [0.3, 0.9, 0.35] },
  // A person changed the idea in the UI.
  manualEdit: { halfLifeMs: 60 * 60_000, weight: 1, color: [0.95, 0.35, 0.85] }
} as const satisfies Record<string, { halfLifeMs: number; weight: number; color: readonly [number, number, number] }>;

export type IdeaAccessKind = keyof typeof IDEA_ACCESS_KINDS;

// How the additive, decaying count works
// ---------------------------------------
// The activity of one kind at time `now` is the sum over its accesses, each
// halved every half-life h since it happened:
//
//   activity(now) = Σᵢ 2^(−(now − tᵢ)/h) = 2^(−now/h) · Σᵢ 2^(tᵢ/h)
//
// The sum on the right no longer depends on `now`, so it is all we store:
// recording an access adds 2^(t/h) to it, merging two records adds the two
// sums, and the decay is applied only when reading. No "last updated" time is
// needed — every access already carries its time inside its term, and the
// common factor 2^(−now/h) is the same for all of them.
//
// 2^(t/h) with t in ms since 1970 overflows a double (t/h is ~6·10⁶ for a
// 5-minute half-life), so we store the sum's base-2 logarithm, the "level":
//
//   level = log₂ Σᵢ 2^(tᵢ/h)      activity(now) = 2^(level − now/h)
//
// Adding to the sum becomes log-add-exp on levels (`addLevels`). A single
// access at t has level t/h — the access time in half-lives — and two accesses
// at the same moment have level t/h + 1. Levels of one kind compare like
// activities, so they can be sorted without decoding.

// Per kind, the level of all its accesses so far (see above).
export type IdeaActivity = Partial<Record<IdeaAccessKind, number>>;

// `seq` numbers accesses in the order the backend recorded them, so a client
// can tell which ones a snapshot already contains (`IdeaActivitySnapshot.seq`).
export type IdeaActivityEvent = { projectPath: string; ideaIds: string[]; kind: IdeaAccessKind; at: number; seq: number };

export type IdeaActivitySnapshot = { seq: number; ideas: Record<string, IdeaActivity> };

// log₂(2^a + 2^b), computed around the larger value so nothing overflows.
// `undefined` is the empty sum (no accesses yet).
export function addLevels(a: number | undefined, b: number): number {
  if (a === undefined) return b;
  const high = Math.max(a, b);
  return high + Math.log2(1 + 2 ** (Math.min(a, b) - high));
}

// The level after one more access of `kind` at time `at`.
export function addAccess(activity: IdeaActivity | undefined, kind: IdeaAccessKind, at: number): IdeaActivity {
  const level = addLevels(activity?.[kind], at / IDEA_ACCESS_KINDS[kind].halfLifeMs);
  return { ...activity, [kind]: level };
}

// How strongly a kind still glows: its weight times the decayed number of
// accesses. One access glows at `weight` and halves every half-life.
export function accessStrength(kind: IdeaAccessKind, level: number, now: number): number {
  const { halfLifeMs, weight } = IDEA_ACCESS_KINDS[kind];
  return weight * 2 ** (level - now / halfLifeMs);
}

const IDLE_COLOR = [0.16, 0.16, 0.16] as const;
// Activity adds at most #888 per channel on top of the idle grey, so the
// white labels on the nodes stay readable.
const MAX_GLOW = 0x88 / 0xff;

// Idle grey plus each kind's color by its current strength, capped per channel.
export function ideaActivityColor(activity: IdeaActivity | undefined, now: number): [number, number, number] {
  const glow = [0, 0, 0];
  for (const kind in activity) {
    const strength = accessStrength(kind as IdeaAccessKind, activity[kind as IdeaAccessKind]!, now);
    const kindColor = IDEA_ACCESS_KINDS[kind as IdeaAccessKind].color;
    for (let channel = 0; channel < 3; channel++) glow[channel]! += kindColor[channel]! * strength * MAX_GLOW;
  }
  return IDLE_COLOR.map((idle, channel) => idle + Math.min(MAX_GLOW, glow[channel]!)) as [number, number, number];
}
