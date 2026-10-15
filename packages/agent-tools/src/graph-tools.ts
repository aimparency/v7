import { createTRPCClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from 'backend';
import {
  calculateIdeaValues,
  missionPathsToRoot,
  resolveWorkPhase,
  selectWorkCandidates,
  type Idea,
  type Phase
} from 'shared';

export type PrioritizedIdea = {
  idea: Idea;
  phase: Phase;
  priority: number;
  value: number;
  cost: number;
};

export type GraphTools = ReturnType<typeof connectGraph>;

/**
 * The idea graph of one project, read and changed through the backend that
 * spawned this worker — the same API MCP agents use. Its writes take the
 * backend's file locks, emit change events (live UI, undo history) and keep the
 * search index current. close() releases the socket so the process can exit.
 */
export function connectGraph(projectPath: string) {
  const host = process.env.BACKEND_WS_HOST || process.env.BIND_HOST || 'localhost';
  const socket = createWSClient({ url: `ws://${host}:${process.env.PORT_BACKEND_WS || '3001'}` });
  const backend = createTRPCClient<AppRouter>({ links: [wsLink({ client: socket })] });

  const listIdeas = () => backend.idea.list.query({ projectPath });
  const listPhases = () => backend.phase.list.query({ projectPath });

  // Same selection and ranking as MCP get_prioritized_ideas.
  async function getPrioritizedIdeas(limit = 10, phaseId?: string | null): Promise<PrioritizedIdea[]> {
    const [ideas, phases] = await Promise.all([listIdeas(), listPhases()]);
    const phase = resolveWorkPhase(phases, phaseId);
    if (!phase) return [];
    const { scope, candidates } = selectWorkCandidates(ideas, phase);
    // Exploration candidates are containers to decompose, not work to execute.
    if (scope === 'mission-containers-exploration') return [];
    const { priorities, values, costs, totalIntrinsic } = calculateIdeaValues(ideas);
    return candidates
      .map((idea) => ({
        idea,
        phase,
        priority: priorities.get(idea.id) ?? 0,
        value: (values.get(idea.id) ?? 0) * totalIntrinsic,
        cost: costs.get(idea.id) ?? 0
      }))
      .sort((left, right) => right.priority - left.priority)
      .slice(0, limit);
  }

  async function getIdeaContext(ideaId: string) {
    const ideas = await listIdeas();
    const ideaMap = new Map(ideas.map((idea) => [idea.id, idea]));
    const idea = ideaMap.get(ideaId);
    if (!idea) throw new Error(`Idea not found: ${ideaId}`);
    const { flowValues } = calculateIdeaValues(ideas);
    const { pathToRoot, pathsToRoot, truncated } = missionPathsToRoot(ideaMap, idea, flowValues);
    const brief = (id: string) => {
      const relative = ideaMap.get(id);
      return relative ? [{ id: relative.id, text: relative.text, description: relative.description }] : [];
    };
    return {
      idea: { id: idea.id, text: idea.text, description: idea.description, status: idea.status },
      path_to_root: pathToRoot,
      paths_to_root: pathsToRoot,
      paths_to_root_truncated: truncated,
      parents: (idea.supportedIdeas ?? []).flatMap(brief),
      children: (idea.supportingConnections ?? []).flatMap((connection) => brief(connection.ideaId))
    };
  }

  async function searchIdeas(query: string, limit = 8) {
    const results = await backend.idea.searchSemantic.query({ projectPath, query, limit });
    return results.map((idea) => ({ id: idea.id, text: idea.text, description: idea.description, status: idea.status }));
  }

  async function createIdea(input: {
    text: string;
    description?: string;
    supportedIdeas?: string[];
    phaseId?: string;
    cost?: number;
    intrinsicValue?: number;
    valueRationale?: string;
  }) {
    const { phaseId, ...idea } = input;
    return phaseId
      ? backend.idea.createIdeaInPhase.mutate({ projectPath, phaseId, idea })
      : backend.idea.createFloatingIdea.mutate({ projectPath, idea });
  }

  async function updateIdea(
    ideaId: string,
    idea: Partial<Pick<Idea, 'text' | 'description' | 'cost' | 'intrinsicValue' | 'valueRationale'>> & { status?: { state: string; comment?: string } }
  ) {
    return backend.idea.update.mutate({
      projectPath,
      ideaId,
      idea: idea.status ? { ...idea, status: { ...idea.status, date: Date.now() } } : idea
    });
  }

  async function commitIdeaToPhase(ideaId: string, phaseId: string) {
    await backend.idea.commitToPhase.mutate({ projectPath, ideaId, phaseId });
    return { ideaId, phaseId, committed: true };
  }

  return {
    listIdeas,
    listPhases,
    getPrioritizedIdeas,
    getIdeaContext,
    searchIdeas,
    graphHygiene: () => backend.graphHealth.graphHygiene.query({ projectPath }),
    createIdea,
    updateIdea,
    commitIdeaToPhase,
    close: () => socket.close()
  };
}
