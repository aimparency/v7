import type { Idea, Phase } from 'shared';
import { connectIdeasInternal, readIdea } from './ideas.js';
import { readPhase } from './phases.js';
import { commitIdeaToPhase } from './commitments.js';
import { detachIdea, type IdeaContext } from './idea-removal.js';

const sameContext = (a: IdeaContext, b: IdeaContext) =>
  'parentId' in a ? 'parentId' in b && a.parentId === b.parentId : 'phaseId' in b && a.phaseId === b.phaseId;

// Moves an idea out of `from` to `index` under `to`, as one operation. Without
// `from` it only attaches (a copy); without `to` it only detaches (the idea
// floats). Within the same parent or phase it reorders; index is relative to
// the list without the idea. A parent → parent move keeps the parent's slot in
// the idea's supportedIdeas. Returns the touched ideas and phases as stored.
export async function moveIdea(
  projectPath: string,
  ideaId: string,
  { from, to, index }: { from?: IdeaContext; to?: IdeaContext; index?: number }
): Promise<{ ideas: Idea[]; phases: Phase[] }> {
  let parentSlot: number | undefined;
  if (from && 'parentId' in from && to && 'parentId' in to) {
    const slot = (await readIdea(projectPath, ideaId)).supportedIdeas.indexOf(from.parentId);
    if (slot !== -1) parentSlot = slot;
  }
  if (from && !(to && sameContext(from, to))) await detachIdea(projectPath, ideaId, from);
  if (to && 'parentId' in to) {
    await connectIdeasInternal(projectPath, to.parentId, ideaId, index, parentSlot);
  } else if (to) {
    await commitIdeaToPhase(projectPath, ideaId, to.phaseId, index);
  }

  const ideaIds = new Set([ideaId]);
  const phaseIds = new Set<string>();
  for (const context of [from, to]) {
    if (!context) continue;
    if ('parentId' in context) ideaIds.add(context.parentId);
    else phaseIds.add(context.phaseId);
  }
  return {
    ideas: await Promise.all([...ideaIds].map((id) => readIdea(projectPath, id))),
    phases: await Promise.all([...phaseIds].map((id) => readPhase(projectPath, id)))
  };
}
