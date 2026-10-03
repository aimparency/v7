import { EventEmitter } from 'events';
import type { Idea, Phase, ProjectMeta } from 'shared';

// One stream of "something in a project changed" events: storage writes and
// deletes emit, the onUpdate subscription forwards them to clients, value
// recalculation listens. Listeners run synchronously inside the emitting
// request (see change-origin.ts).
export type ChangeEvent = {
  type: 'idea' | 'phase' | 'project' | 'system' | 'loop';
  id: string;
  projectPath: string;
  entity?: Idea | Phase | ProjectMeta;
  deleted?: boolean;
  // Raw prior content, for undo (history router).
  previous?: unknown;
};

const emitter = new EventEmitter();

export function emitChange(event: ChangeEvent): void {
  emitter.emit('change', event);
}

export function onChange(listener: (event: ChangeEvent) => void): () => void {
  emitter.on('change', listener);
  return () => emitter.off('change', listener);
}
