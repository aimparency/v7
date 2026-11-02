import type { Idea } from './types.js';

const SETTLED = new Set(['implemented', 'cancelled', 'failed', 'archived']);

export type ChildBrief = { id: string; text: string; status: string; description?: string };

/**
 * A child as an agent's context shows it: open work in full, settled work as
 * one line (id, title, state). Containers of mostly finished ideas used to
 * repeat every finished child's description, and without the state an agent
 * could not tell which children were still open.
 */
export function childBrief(idea: Pick<Idea, 'id' | 'text' | 'description' | 'status'>): ChildBrief {
  const status = idea.status.state;
  return SETTLED.has(status)
    ? { id: idea.id, text: idea.text, status }
    : { id: idea.id, text: idea.text, status, description: idea.description };
}
