import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AimSchema, PhaseSchema, calculateAimValues, type Aim, type Phase } from 'shared';
import { normalizeBowmanPath, writeJsonAtomic } from './loop-state.js';

export type PrioritizedAim = {
  aim: Aim;
  phase: Phase;
  priority: number;
  value: number;
  cost: number;
};

function aimsDir(projectPath: string): string {
  return path.join(normalizeBowmanPath(projectPath), 'aims');
}

function phasesDir(projectPath: string): string {
  return path.join(normalizeBowmanPath(projectPath), 'phases');
}

export async function listAimsFromFiles(projectPath: string, archived = false): Promise<Aim[]> {
  const dir = aimsDir(projectPath);
  const files = (await fs.pathExists(dir)) ? await fs.readdir(dir) : [];
  const aims: Aim[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const aim = AimSchema.parse(await fs.readJson(path.join(dir, file)));
      if (Boolean(aim.archived) === archived) aims.push(aim);
    } catch {
      // Ignore malformed aims here; consistency tools handle graph repair.
    }
  }
  return aims;
}

export async function listPhasesFromFiles(projectPath: string): Promise<Phase[]> {
  const dir = phasesDir(projectPath);
  const files = (await fs.pathExists(dir)) ? await fs.readdir(dir) : [];
  const phases: Phase[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      phases.push(PhaseSchema.parse(await fs.readJson(path.join(dir, file))));
    } catch {
      // Ignore malformed phases here; consistency tools handle graph repair.
    }
  }
  return phases;
}

export async function writeAimToFile(projectPath: string, aim: Aim): Promise<void> {
  await writeJsonAtomic(path.join(aimsDir(projectPath), `${aim.id}.json`), AimSchema.parse(aim));
}

export async function writePhaseToFile(projectPath: string, phase: Phase): Promise<void> {
  await writeJsonAtomic(path.join(phasesDir(projectPath), `${phase.id}.json`), PhaseSchema.parse(phase));
}

export async function getPrioritizedAims(projectPath: string, limit = 10, phaseId?: string | null): Promise<PrioritizedAim[]> {
  const [aims, phases] = await Promise.all([
    listAimsFromFiles(projectPath),
    listPhasesFromFiles(projectPath)
  ]);
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  let targetPhases: Phase[];
  if (phaseId) {
    const phase = phaseById.get(phaseId);
    targetPhases = phase ? [phase] : [];
  } else {
    const now = Date.now();
    const isActive = (phase: Phase) =>
      (phase.from ?? 0) > 0 && (phase.to ?? 0) > 0 && phase.from! <= now && now <= phase.to!;
    const activePhases = phases.filter(isActive);
    const hasActiveChild = (phase: Phase) =>
      (phase.childPhaseIds ?? []).some((childId) => {
        const child = phaseById.get(childId);
        return child !== undefined && isActive(child);
      });
    const leaves = activePhases.filter((phase) => !hasActiveChild(phase));
    const candidates = leaves.length > 0 ? leaves : activePhases;
    const findWithCommitments = (phase: Phase | undefined): Phase | null => {
      if (!phase) return null;
      if ((phase.commitments ?? []).length > 0) return phase;
      return findWithCommitments(phase.parent ? phaseById.get(phase.parent) : undefined);
    };
    targetPhases = candidates
      .map((phase) => findWithCommitments(phase))
      .filter((phase): phase is Phase => phase !== null);
  }
  const { priorities, values, costs, totalIntrinsic } = calculateAimValues(aims);
  const byId = new Map(aims.map((aim) => [aim.id, aim]));
  const rows: PrioritizedAim[] = [];
  for (const phase of targetPhases) {
    for (const aimId of phase.commitments ?? []) {
      const aim = byId.get(aimId);
      if (!aim || aim.status.state !== 'open') continue;
      rows.push({
        aim,
        phase,
        priority: priorities.get(aim.id) ?? 0,
        value: (values.get(aim.id) ?? 0) * totalIntrinsic,
        cost: costs.get(aim.id) ?? 0
      });
    }
  }
  return rows
    .sort((left, right) => right.priority - left.priority)
    .slice(0, limit);
}

export async function getAimContext(projectPath: string, aimId: string) {
  const aims = await listAimsFromFiles(projectPath);
  const aimMap = new Map(aims.map((aim) => [aim.id, aim]));
  const aim = aimMap.get(aimId);
  if (!aim) throw new Error(`Aim not found: ${aimId}`);
  const { flowValues } = calculateAimValues(aims);
  const pathToRoot = [];
  const visited = new Set<string>([aimId]);
  let cursor: Aim = aim;
  while (pathToRoot.length < 12) {
    const parentIds = (cursor.supportedAims ?? []).filter((id) => aimMap.has(id) && !visited.has(id));
    if (parentIds.length === 0) break;
    let best = parentIds[0];
    let bestFlow = flowValues.get(`${best}->${cursor.id}`) ?? 0;
    for (const parentId of parentIds) {
      const flow = flowValues.get(`${parentId}->${cursor.id}`) ?? 0;
      if (flow > bestFlow) {
        best = parentId;
        bestFlow = flow;
      }
    }
    const parent = aimMap.get(best)!;
    visited.add(parent.id);
    pathToRoot.push({
      id: parent.id,
      text: parent.text,
      description: parent.description,
      intrinsicValue: parent.intrinsicValue ?? 0,
      valueInflow: Number(bestFlow.toFixed(4))
    });
    cursor = parent;
  }
  pathToRoot.reverse();
  const parents = (aim.supportedAims ?? [])
    .map((id) => aimMap.get(id))
    .filter(Boolean)
    .map((parent) => ({ id: parent!.id, text: parent!.text, description: parent!.description }));
  const children = (aim.supportingConnections ?? [])
    .map((connection) => aimMap.get(connection.aimId))
    .filter(Boolean)
    .map((child) => ({ id: child!.id, text: child!.text, description: child!.description }));
  return {
    aim: { id: aim.id, text: aim.text, description: aim.description, status: aim.status },
    path_to_root: pathToRoot,
    parents,
    children
  };
}

export async function searchAimsSemanticLite(projectPath: string, query: string, limit = 8) {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length >= 3);
  const aims = await listAimsFromFiles(projectPath);
  return aims
    .map((aim) => {
      const hay = `${aim.text} ${aim.description ?? ''} ${(aim.tags ?? []).join(' ')}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0);
      return { id: aim.id, text: aim.text, description: aim.description, status: aim.status, score };
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export async function createAim(projectPath: string, input: {
  text: string;
  description?: string;
  supportedAims?: string[];
  phaseId?: string;
  cost?: number;
  intrinsicValue?: number;
}) {
  const now = Date.now();
  const aim: Aim = AimSchema.parse({
    id: uuidv4(),
    text: input.text,
    description: input.description ?? '',
    reflections: [],
    archived: false,
    tags: [],
    supportingConnections: [],
    supportedAims: input.supportedAims ?? [],
    committedIn: input.phaseId ? [input.phaseId] : [],
    status: { state: 'open', comment: '', date: now },
    intrinsicValue: input.intrinsicValue ?? 0,
    cost: input.cost ?? 1,
    loopWeight: 0,
    duration: 1,
    costVariance: 0,
    valueVariance: 0
  });
  await writeAimToFile(projectPath, aim);
  const aims = new Map((await listAimsFromFiles(projectPath)).map((candidate) => [candidate.id, candidate]));
  for (const parentId of aim.supportedAims ?? []) {
    const parent = aims.get(parentId);
    if (!parent) continue;
    if (!(parent.supportingConnections ?? []).some((connection) => connection.aimId === aim.id)) {
      parent.supportingConnections = [...(parent.supportingConnections ?? []), { aimId: aim.id, relativePosition: [0, 0], weight: 1 }];
      await writeAimToFile(projectPath, parent);
    }
  }
  if (input.phaseId) {
    const phasePath = path.join(phasesDir(projectPath), `${input.phaseId}.json`);
    const phase = PhaseSchema.parse(await fs.readJson(phasePath));
    if (!phase.commitments.includes(aim.id)) {
      phase.commitments.push(aim.id);
      await writePhaseToFile(projectPath, phase);
    }
  }
  return aim;
}

export async function commitAimToPhase(projectPath: string, aimId: string, phaseId: string) {
  const aims = await listAimsFromFiles(projectPath, true).then(async (archived) => [...await listAimsFromFiles(projectPath), ...archived]);
  const aim = aims.find((candidate) => candidate.id === aimId);
  if (!aim) throw new Error(`Aim not found: ${aimId}`);
  const phasePath = path.join(phasesDir(projectPath), `${phaseId}.json`);
  const phase = PhaseSchema.parse(await fs.readJson(phasePath));
  if (!phase.commitments.includes(aimId)) {
    phase.commitments.push(aimId);
    await writePhaseToFile(projectPath, phase);
  }
  if (!(aim.committedIn ?? []).includes(phaseId)) {
    aim.committedIn = [...(aim.committedIn ?? []), phaseId];
    await writeAimToFile(projectPath, aim);
  }
  return { aimId, phaseId, committed: true };
}

export async function updateAim(projectPath: string, aimId: string, patch: Partial<Pick<Aim, 'text' | 'description' | 'status' | 'cost' | 'intrinsicValue'>>) {
  const aims = await listAimsFromFiles(projectPath, true).then(async (archived) => [...await listAimsFromFiles(projectPath), ...archived]);
  const aim = aims.find((candidate) => candidate.id === aimId);
  if (!aim) throw new Error(`Aim not found: ${aimId}`);
  const next = AimSchema.parse({
    ...aim,
    ...patch,
    status: patch.status ? { ...patch.status, date: patch.status.date ?? Date.now() } : aim.status
  });
  await writeAimToFile(projectPath, next);
  return next;
}

export async function graphHygiene(projectPath: string) {
  const [aims, phases] = await Promise.all([listAimsFromFiles(projectPath), listPhasesFromFiles(projectPath)]);
  const committed = new Set(phases.flatMap((phase) => phase.commitments ?? []));
  const floating = aims.filter((aim) => !committed.has(aim.id) && (aim.supportedAims ?? []).length === 0);
  const uncommittedOpen = aims.filter((aim) => aim.status.state === 'open' && !committed.has(aim.id) && (aim.supportedAims ?? []).length > 0);
  const megaParents = aims
    .filter((aim) => (aim.supportingConnections ?? []).length >= 25)
    .map((aim) => ({ id: aim.id, text: aim.text, childCount: aim.supportingConnections.length }));
  return {
    floating: floating.slice(0, 30).map((aim) => ({ id: aim.id, text: aim.text })),
    uncommittedOpen: uncommittedOpen.slice(0, 30).map((aim) => ({ id: aim.id, text: aim.text })),
    megaParents: megaParents.slice(0, 30)
  };
}
