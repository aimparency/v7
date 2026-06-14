import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import { WebSocket } from "ws";
import { calculateAimValues } from "shared";
import type { AppRouter, Aim, Phase, Reflection } from "shared";

export const wsClient = createWSClient({
  url: `ws://localhost:${process.env.PORT_BACKEND_WS || "3001"}`,
});

export const trpc = createTRPCClient<AppRouter>({
  links: [wsLink({ client: wsClient })],
});

export interface PrioritizedAim {
  aim: Aim;
  priority: number;
  flowedValue: number;
  aggregatedCost: number;
  phasePath: string[];
}

/**
 * Same resolution as the MCP's get_prioritized_aims: deepest currently-active
 * leaf phase with open commitments, ranked by the flow-based economic model.
 */
export async function getTopAims(
  projectPath: string,
  limit = 3
): Promise<PrioritizedAim[]> {
  const allPhases = (await trpc.phase.list.query({ projectPath })) as Phase[];
  const phaseById = new Map(allPhases.map((p) => [p.id, p]));

  const now = Date.now();
  const isActive = (p: Phase) =>
    (p.from ?? 0) > 0 && (p.to ?? 0) > 0 && p.from! <= now && now <= p.to!;
  const activePhases = allPhases.filter(isActive);

  const hasActiveChild = (phase: Phase) =>
    (phase.childPhaseIds ?? []).some((cid: string) => {
      const child = phaseById.get(cid);
      return child !== undefined && isActive(child);
    });

  const leaves = activePhases.filter((p) => !hasActiveChild(p));
  const candidates = leaves.length > 0 ? leaves : activePhases;

  const findWithCommitments = (phase: Phase | undefined): Phase | null => {
    if (!phase) return null;
    if ((phase.commitments ?? []).length > 0) return phase;
    return findWithCommitments(
      phase.parent ? phaseById.get(phase.parent) : undefined
    );
  };

  let targetPhase: Phase | null = null;
  for (const leaf of candidates) {
    targetPhase = findWithCommitments(leaf);
    if (targetPhase) break;
  }
  if (!targetPhase) throw new Error("No active phase with commitments found.");

  const allAims = (await trpc.aim.list.query({ projectPath })) as Aim[];
  const { priorities, values, costs, totalIntrinsic } = calculateAimValues(allAims);

  const committed = new Set(targetPhase.commitments ?? []);
  const open = allAims.filter(
    (a) => committed.has(a.id) && a.status.state === "open"
  );

  const phasePath: string[] = [];
  let cur: Phase | undefined = targetPhase;
  while (cur) {
    phasePath.unshift(cur.name);
    cur = cur.parent ? phaseById.get(cur.parent) : undefined;
  }

  return open
    .map((aim) => ({
      aim,
      priority: priorities.get(aim.id) ?? 0,
      flowedValue: (values.get(aim.id) ?? 0) * totalIntrinsic,
      aggregatedCost: costs.get(aim.id) ?? 0,
      phasePath,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

export async function appendReflection(
  projectPath: string,
  aimId: string,
  reflection: Omit<Reflection, "date">
): Promise<void> {
  const aim = (await trpc.aim.get.query({ projectPath, aimId })) as Aim;
  await trpc.aim.update.mutate({
    projectPath,
    aimId,
    aim: {
      reflections: [...(aim.reflections ?? []), { date: Date.now(), ...reflection }],
    },
  });
}
