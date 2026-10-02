import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { IdeaSchema, PhaseSchema, calculateIdeaValues, defaultIdeaCost, type Idea, type Phase } from 'shared';
import { assertWritableBowman, migrateBowman } from 'shared/bowman-migration';
import { normalizeBowmanPath, writeJsonAtomic } from './loop-state.js';

export type PrioritizedIdea = {
  idea: Idea;
  phase: Phase;
  priority: number;
  value: number;
  cost: number;
};

/** Brings the .bowman to the current data model before its files are read or written directly. */
export async function ensureCurrentLayout(projectPath: string): Promise<void> {
  await migrateBowman(normalizeBowmanPath(projectPath));
}

function ideasDir(projectPath: string): string {
  return path.join(normalizeBowmanPath(projectPath), 'ideas');
}

function phasesDir(projectPath: string): string {
  return path.join(normalizeBowmanPath(projectPath), 'phases');
}

export async function listIdeasFromFiles(projectPath: string, archived = false): Promise<Idea[]> {
  await ensureCurrentLayout(projectPath);
  const dir = ideasDir(projectPath);
  const files = (await fs.pathExists(dir)) ? await fs.readdir(dir) : [];
  const ideas: Idea[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const idea = IdeaSchema.parse(await fs.readJson(path.join(dir, file)));
      if (Boolean(idea.archived) === archived) ideas.push(idea);
    } catch {
      // Ignore malformed ideas here; consistency tools handle graph repair.
    }
  }
  return ideas;
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

export async function writeIdeaToFile(projectPath: string, idea: Idea): Promise<void> {
  await ensureCurrentLayout(projectPath);
  await assertWritableBowman(normalizeBowmanPath(projectPath));
  await writeJsonAtomic(path.join(ideasDir(projectPath), `${idea.id}.json`), IdeaSchema.parse(idea));
}

export async function writePhaseToFile(projectPath: string, phase: Phase): Promise<void> {
  await assertWritableBowman(normalizeBowmanPath(projectPath));
  await writeJsonAtomic(path.join(phasesDir(projectPath), `${phase.id}.json`), PhaseSchema.parse(phase));
}

export async function getPrioritizedIdeas(projectPath: string, limit = 10, phaseId?: string | null): Promise<PrioritizedIdea[]> {
  const [ideas, phases] = await Promise.all([
    listIdeasFromFiles(projectPath),
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
  const { priorities, values, costs, totalIntrinsic } = calculateIdeaValues(ideas);
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const rows: PrioritizedIdea[] = [];
  for (const phase of targetPhases) {
    for (const ideaId of phase.commitments ?? []) {
      const idea = byId.get(ideaId);
      if (!idea || idea.status.state !== 'open') continue;
      rows.push({
        idea,
        phase,
        priority: priorities.get(idea.id) ?? 0,
        value: (values.get(idea.id) ?? 0) * totalIntrinsic,
        cost: costs.get(idea.id) ?? 0
      });
    }
  }
  return rows
    .sort((left, right) => right.priority - left.priority)
    .slice(0, limit);
}

export async function getIdeaContext(projectPath: string, ideaId: string) {
  const ideas = await listIdeasFromFiles(projectPath);
  const ideaMap = new Map(ideas.map((idea) => [idea.id, idea]));
  const idea = ideaMap.get(ideaId);
  if (!idea) throw new Error(`Idea not found: ${ideaId}`);
  const { flowValues } = calculateIdeaValues(ideas);
  const MAX_PATH_DEPTH = 64;
  const MAX_PATHS = 100;
  const pathToRoot = [];
  const visited = new Set<string>([ideaId]);
  let cursor: Idea = idea;
  while (pathToRoot.length < MAX_PATH_DEPTH) {
    const parentIds = (cursor.supportedIdeas ?? []).filter((id) => ideaMap.has(id) && !visited.has(id));
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
    const parent = ideaMap.get(best)!;
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
  const pathsToRoot: Array<Array<{
    id: string;
    text: string;
    description?: string;
    intrinsicValue: number;
    valueInflow: number;
  }>> = [];
  let pathsToRootTruncated = false;
  const walkAllParents = (
    current: Idea,
    upwardPath: typeof pathsToRoot[number],
    branchVisited: Set<string>
  ) => {
    if (pathsToRoot.length >= MAX_PATHS) {
      pathsToRootTruncated = true;
      return;
    }
    if (upwardPath.length >= MAX_PATH_DEPTH) {
      pathsToRootTruncated = true;
      return;
    }
    const existingParentIds = (current.supportedIdeas ?? []).filter((id) => ideaMap.has(id));
    if (existingParentIds.length === 0) {
      pathsToRoot.push([...upwardPath].reverse());
      return;
    }
    let followedParent = false;
    for (const parentId of existingParentIds) {
      if (branchVisited.has(parentId)) continue;
      followedParent = true;
      const parent = ideaMap.get(parentId)!;
      const flow = flowValues.get(`${parentId}->${current.id}`) ?? 0;
      walkAllParents(
        parent,
        [...upwardPath, {
          id: parent.id,
          text: parent.text,
          description: parent.description,
          intrinsicValue: parent.intrinsicValue ?? 0,
          valueInflow: Number(flow.toFixed(4))
        }],
        new Set([...branchVisited, parentId])
      );
    }
    if (!followedParent) return;
  };
  walkAllParents(idea, [], new Set([ideaId]));
  const parents = (idea.supportedIdeas ?? [])
    .map((id) => ideaMap.get(id))
    .filter(Boolean)
    .map((parent) => ({ id: parent!.id, text: parent!.text, description: parent!.description }));
  const children = (idea.supportingConnections ?? [])
    .map((connection) => ideaMap.get(connection.ideaId))
    .filter(Boolean)
    .map((child) => ({ id: child!.id, text: child!.text, description: child!.description }));
  return {
    idea: { id: idea.id, text: idea.text, description: idea.description, status: idea.status },
    path_to_root: pathToRoot,
    paths_to_root: pathsToRoot,
    paths_to_root_truncated: pathsToRootTruncated,
    parents,
    children
  };
}

export async function searchIdeasSemanticLite(projectPath: string, query: string, limit = 8) {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length >= 3);
  const ideas = await listIdeasFromFiles(projectPath);
  return ideas
    .map((idea) => {
      const hay = `${idea.text} ${idea.description ?? ''} ${(idea.tags ?? []).join(' ')}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0);
      return { id: idea.id, text: idea.text, description: idea.description, status: idea.status, score };
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export async function createIdea(projectPath: string, input: {
  text: string;
  description?: string;
  supportedIdeas?: string[];
  phaseId?: string;
  cost?: number;
  intrinsicValue?: number;
  valueRationale?: string;
}) {
  const now = Date.now();
  const meta = await fs.readJson(path.join(normalizeBowmanPath(projectPath), 'meta.json')).catch(() => null);
  const idea: Idea = IdeaSchema.parse({
    id: uuidv4(),
    text: input.text,
    description: input.description ?? '',
    reflections: [],
    archived: false,
    tags: [],
    supportingConnections: [],
    supportedIdeas: input.supportedIdeas ?? [],
    committedIn: input.phaseId ? [input.phaseId] : [],
    status: { state: 'open', comment: '', date: now },
    intrinsicValue: input.intrinsicValue ?? 0,
    valueRationale: input.valueRationale,
    cost: input.cost ?? defaultIdeaCost(meta),
    loopWeight: 0,
    duration: 1,
    costVariance: 0,
    valueVariance: 0
  });
  await writeIdeaToFile(projectPath, idea);
  const ideas = new Map((await listIdeasFromFiles(projectPath)).map((candidate) => [candidate.id, candidate]));
  for (const parentId of idea.supportedIdeas ?? []) {
    const parent = ideas.get(parentId);
    if (!parent) continue;
    if (!(parent.supportingConnections ?? []).some((connection) => connection.ideaId === idea.id)) {
      parent.supportingConnections = [...(parent.supportingConnections ?? []), { ideaId: idea.id, relativePosition: [0, 0], weight: 1 }];
      await writeIdeaToFile(projectPath, parent);
    }
  }
  if (input.phaseId) {
    const phasePath = path.join(phasesDir(projectPath), `${input.phaseId}.json`);
    const phase = PhaseSchema.parse(await fs.readJson(phasePath));
    if (!phase.commitments.includes(idea.id)) {
      phase.commitments.push(idea.id);
      await writePhaseToFile(projectPath, phase);
    }
  }
  return idea;
}

export async function commitIdeaToPhase(projectPath: string, ideaId: string, phaseId: string) {
  const ideas = await listIdeasFromFiles(projectPath, true).then(async (archived) => [...await listIdeasFromFiles(projectPath), ...archived]);
  const idea = ideas.find((candidate) => candidate.id === ideaId);
  if (!idea) throw new Error(`Idea not found: ${ideaId}`);
  const phasePath = path.join(phasesDir(projectPath), `${phaseId}.json`);
  const phase = PhaseSchema.parse(await fs.readJson(phasePath));
  if (!phase.commitments.includes(ideaId)) {
    phase.commitments.push(ideaId);
    await writePhaseToFile(projectPath, phase);
  }
  if (!(idea.committedIn ?? []).includes(phaseId)) {
    idea.committedIn = [...(idea.committedIn ?? []), phaseId];
    await writeIdeaToFile(projectPath, idea);
  }
  return { ideaId, phaseId, committed: true };
}

export async function updateIdea(projectPath: string, ideaId: string, patch: Partial<Pick<Idea, 'text' | 'description' | 'status' | 'cost' | 'intrinsicValue' | 'valueRationale'>>) {
  const ideas = await listIdeasFromFiles(projectPath, true).then(async (archived) => [...await listIdeasFromFiles(projectPath), ...archived]);
  const idea = ideas.find((candidate) => candidate.id === ideaId);
  if (!idea) throw new Error(`Idea not found: ${ideaId}`);
  const next = IdeaSchema.parse({
    ...idea,
    ...patch,
    status: patch.status ? { ...patch.status, date: patch.status.date ?? Date.now() } : idea.status
  });
  await writeIdeaToFile(projectPath, next);
  return next;
}

// Hygiene = defects only. Uncommitted-open ideas are not one: they contribute
// through their parents (see idea 6f9bef89), so they are browsed via the
// uncommitted filter rather than reported here.
export async function graphHygiene(projectPath: string) {
  const [ideas, phases] = await Promise.all([listIdeasFromFiles(projectPath), listPhasesFromFiles(projectPath)]);
  const committed = new Set(phases.flatMap((phase) => phase.commitments ?? []));
  const floating = ideas.filter((idea) => !committed.has(idea.id) && (idea.supportedIdeas ?? []).length === 0);
  const megaParents = ideas
    .filter((idea) => (idea.supportingConnections ?? []).length >= 25)
    .map((idea) => ({ id: idea.id, text: idea.text, childCount: idea.supportingConnections.length }));
  return {
    floating: floating.slice(0, 30).map((idea) => ({ id: idea.id, text: idea.text })),
    megaParents: megaParents.slice(0, 30)
  };
}
