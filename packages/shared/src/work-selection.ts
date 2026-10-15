import { INITIAL_STATES } from './constants.js';
import type { Idea, Phase } from './types.js';

// Unknown (custom) states count as ongoing: unsure means not settled.
export const isOngoingState = (state: string | undefined) =>
  INITIAL_STATES.find((candidate) => candidate.key === state)?.ongoing ?? true;

/**
 * The phase an agent works in: the requested one, else the deepest dated,
 * currently running phase that (or whose nearest ancestor) has commitments.
 * Cursor state in meta.json is not used: it can be stale.
 */
export function resolveWorkPhase(phases: Phase[], phaseId?: string | null, now = Date.now()): Phase | null {
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  if (phaseId) {
    const requested = phaseById.get(phaseId);
    if (requested) return requested;
  }
  // Legacy: phases no longer get dates; only old ones still carry them.
  const isRunning = (phase: Phase) =>
    (phase.from ?? 0) > 0 && (phase.to ?? 0) > 0 && phase.from! <= now && now <= phase.to!;
  const running = phases.filter(isRunning);
  const deepest = running.filter((phase) =>
    !(phase.childPhaseIds ?? []).some((childId) => {
      const child = phaseById.get(childId);
      return child !== undefined && isRunning(child);
    })
  );
  for (const candidate of deepest.length > 0 ? deepest : running) {
    for (let phase: Phase | undefined = candidate; phase; phase = phase.parent ? phaseById.get(phase.parent) : undefined) {
      if ((phase.commitments ?? []).length > 0) return phase;
    }
  }
  return null;
}

export type WorkSelectionScope = 'phase-commitments' | 'connected-uncommitted-leaves' | 'mission-containers-exploration';

/**
 * What an agent should work on in a phase. Only open leaves are actionable: an
 * idea with an ongoing child (open, in progress, in review, waiting on a human…)
 * is a container whose work lives in that child. Committed leaves come first;
 * without any, open leaves that serve a parent anywhere in the graph are equally
 * valid work. With neither, the phase's open containers are returned only as
 * context for exploration.
 */
export function selectWorkCandidates(ideas: Idea[], phase: Phase) {
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const hasOngoingChild = (idea: Idea) => (idea.supportingConnections ?? []).some((connection) =>
    isOngoingState(ideaById.get(connection.ideaId)?.status?.state ?? 'implemented')
  );
  const isOpenLeaf = (idea: Idea) => idea.status?.state === 'open' && !hasOngoingChild(idea);

  const commitments = new Set(phase.commitments ?? []);
  const committed = ideas.filter((idea) => commitments.has(idea.id));
  const openInPhase = committed.filter((idea) => idea.status?.state === 'open');
  const openLeavesInPhase = openInPhase.filter(isOpenLeaf);
  const uncommittedLeaves = openLeavesInPhase.length === 0
    ? ideas.filter((idea) =>
        isOpenLeaf(idea)
        && (idea.committedIn ?? []).length === 0
        && (idea.supportedIdeas ?? []).length > 0
      )
    : [];

  const [scope, candidates]: [WorkSelectionScope, Idea[]] = openLeavesInPhase.length > 0
    ? ['phase-commitments', openLeavesInPhase]
    : uncommittedLeaves.length > 0
      ? ['connected-uncommitted-leaves', uncommittedLeaves]
      : ['mission-containers-exploration', openInPhase];

  return { scope, candidates, committed, openInPhase, openLeavesInPhase, uncommittedLeaves };
}
