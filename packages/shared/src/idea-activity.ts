// Live activity on ideas, for watching agents work on the graph: per idea, the
// last time of each kind of access. Each kind fades with its own half-life and
// glows in its own color; the graph's Activity color mode blends them.

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

// Last access time (ms since epoch) per kind.
export type IdeaActivity = Partial<Record<IdeaAccessKind, number>>;

export type IdeaActivityEvent = { projectPath: string; ideaIds: string[]; kind: IdeaAccessKind; at: number };

// How strongly one access still glows: its weight, halved every half-life.
export function accessStrength(kind: IdeaAccessKind, at: number, now: number): number {
  const { halfLifeMs, weight } = IDEA_ACCESS_KINDS[kind];
  return weight * 0.5 ** (Math.max(0, now - at) / halfLifeMs);
}

const IDLE_COLOR = [0.16, 0.16, 0.16] as const;

// Idle grey plus each kind's color by its current strength, clamped per channel.
export function ideaActivityColor(activity: IdeaActivity | undefined, now: number): [number, number, number] {
  const color: [number, number, number] = [...IDLE_COLOR];
  for (const kind in activity) {
    const strength = accessStrength(kind as IdeaAccessKind, activity[kind as IdeaAccessKind]!, now);
    const kindColor = IDEA_ACCESS_KINDS[kind as IdeaAccessKind].color;
    for (let channel = 0; channel < 3; channel++) color[channel] = Math.min(1, color[channel]! + kindColor[channel]! * strength);
  }
  return color;
}
