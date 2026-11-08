import type { Idea } from 'shared';

// The context compiler: one pure function that decides what a stage's model
// reads. The harness injects mission path, hypotheses, reflections and similar
// (above all cancelled or failed) ideas deterministically, so the model does
// not spend tool calls to find them. Sections are ranked per stage and trimmed
// to a budget.

export type ContextStage = 'decompose' | 'execute';

export type ContextInput = {
  idea: Idea;
  ideaById: Map<string, Idea>;
  /** Root-first ids of the highest-value path from the root to the idea (excluding the idea). */
  missionPath: string[];
  /** Semantically similar idea ids, most similar first. */
  similarIds: string[];
  recentEvents: string[];
  humanMessages: string[];
  /** Extra facts the harness knows, e.g. priority and phase. */
  facts: Record<string, unknown>;
};

export type CompiledContext = { text: string; included: string[]; dropped: string[]; chars: number };

type Section = { name: string; body: string };

/** Roughly 4 characters per token. */
export const DEFAULT_CONTEXT_BUDGET_CHARS = 48_000;

const SECTION_ORDER: Record<ContextStage, string[]> = {
  decompose: ['idea', 'human messages', 'mission path', 'children', 'cancelled or failed lookalikes', 'siblings', 'lessons from similar ideas', 'similar ideas', 'recent loop events'],
  execute: ['idea', 'human messages', 'mission path', 'children', 'cancelled or failed lookalikes', 'lessons from similar ideas', 'similar ideas', 'recent loop events', 'siblings']
};

const SETTLED_BADLY = new Set(['cancelled', 'failed']);

export function compileContext(input: ContextInput, stage: ContextStage, budgetChars = DEFAULT_CONTEXT_BUDGET_CHARS): CompiledContext {
  const sections = new Map(buildSections(input).map((section) => [section.name, section]));
  const included: string[] = [];
  const dropped: string[] = [];
  const parts: string[] = [];
  let used = 0;
  for (const name of SECTION_ORDER[stage]) {
    const section = sections.get(name);
    if (!section || !section.body.trim()) continue;
    const block = `## ${section.name}\n${section.body}`;
    const room = budgetChars - used;
    if (block.length <= room) {
      parts.push(block);
      used += block.length + 2;
      included.push(name);
    } else if (room > 400) {
      // The section that crosses the budget is cut, the rest is dropped.
      parts.push(`${block.slice(0, room - 40)}\n…[cut to fit the context budget]`);
      used = budgetChars;
      included.push(`${name} (cut)`);
    } else {
      dropped.push(name);
    }
  }
  const text = parts.join('\n\n');
  return { text, included, dropped, chars: text.length };
}

function buildSections(input: ContextInput): Section[] {
  const { idea, ideaById } = input;
  const edge = (parentId: string, childId: string) =>
    ideaById.get(parentId)?.supportingConnections?.find((connection) => connection.ideaId === childId);
  const line = (candidate: Idea) => `- [${candidate.status.state}] ${candidate.text} (${candidate.id.slice(0, 8)})`;
  const withReason = (candidate: Idea) => candidate.status.comment?.trim()
    ? `${line(candidate)}\n  reason: ${oneLine(candidate.status.comment)}`
    : line(candidate);

  const ideaSection = [
    `${idea.text} (${idea.id})`,
    idea.description?.trim() ? `\n${idea.description.trim()}` : '',
    `\nstatus: ${idea.status.state}${idea.status.comment?.trim() ? ` — ${oneLine(idea.status.comment)}` : ''}`,
    idea.cost !== undefined ? `estimated cost: ${idea.cost}` : '',
    ...Object.entries(input.facts).map(([key, value]) => `${key}: ${String(value)}`),
    ...(idea.supportedIdeas ?? []).flatMap((parentId) => {
      const hypothesis = edge(parentId, idea.id)?.hypothesis;
      const parent = ideaById.get(parentId);
      return parent && hypothesis ? [`bet on parent "${parent.text}": ${hypothesis}`] : [];
    })
  ].filter(Boolean).join('\n');

  // Root first; each step says why it serves the one above it.
  const chain = [...input.missionPath, idea.id];
  const missionPath = input.missionPath.map((id, index) => {
    const step = ideaById.get(id);
    if (!step) return '';
    const hypothesis = index > 0 ? edge(chain[index - 1]!, id)?.hypothesis : undefined;
    return `${'  '.repeat(index)}- ${step.text}${hypothesis ? `\n${'  '.repeat(index + 1)}because: ${hypothesis}` : ''}`;
  }).filter(Boolean).join('\n');

  const children = (idea.supportingConnections ?? []).flatMap((connection) => {
    const child = ideaById.get(connection.ideaId);
    if (!child) return [];
    return [[withReason(child), connection.hypothesis ? `  bet: ${connection.hypothesis}` : '', connection.reflection ? `  outcome: ${connection.reflection}` : '']
      .filter(Boolean).join('\n')];
  }).join('\n');

  const siblingIds = new Set((idea.supportedIdeas ?? []).flatMap((parentId) =>
    (ideaById.get(parentId)?.supportingConnections ?? []).map((connection) => connection.ideaId)
  ));
  siblingIds.delete(idea.id);
  const siblings = [...siblingIds].flatMap((id) => ideaById.get(id) ?? []).map(line).join('\n');

  const similar = input.similarIds.flatMap((id) => id === idea.id ? [] : ideaById.get(id) ?? []);
  const lookalikes = similar.filter((candidate) => SETTLED_BADLY.has(candidate.status.state)).map(withReason).join('\n');
  const otherSimilar = similar.filter((candidate) => !SETTLED_BADLY.has(candidate.status.state)).map(line).join('\n');

  // Reflections on the edges of similar ideas: how this kind of bet turned out before.
  const lessons = similar.flatMap((candidate) => (candidate.supportedIdeas ?? []).flatMap((parentId) => {
    const connection = edge(parentId, candidate.id);
    return connection?.reflection
      ? [`- "${candidate.text}" for "${ideaById.get(parentId)?.text ?? parentId}"${connection.hypothesis ? `\n  bet: ${connection.hypothesis}` : ''}\n  outcome: ${connection.reflection}`]
      : [];
  })).join('\n');

  return [
    { name: 'idea', body: ideaSection },
    { name: 'human messages', body: input.humanMessages.join('\n') },
    { name: 'mission path', body: missionPath },
    { name: 'children', body: children },
    { name: 'cancelled or failed lookalikes', body: lookalikes },
    { name: 'siblings', body: siblings },
    { name: 'lessons from similar ideas', body: lessons },
    { name: 'similar ideas', body: otherSimilar },
    { name: 'recent loop events', body: input.recentEvents.join('\n') }
  ];
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}
