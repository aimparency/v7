import { EventEmitter } from 'node:events';

// How far a project's ideas have been read, for the frontend's loading screen.
// Counts only: anyone who may subscribe sees nothing of the content.
export type ProjectLoadProgress = { projectPath: string; done: number; total: number };

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function reportProjectLoadProgress(progress: ProjectLoadProgress): void {
  emitter.emit('progress', progress);
}

export function onProjectLoadProgress(listener: (progress: ProjectLoadProgress) => void): () => void {
  emitter.on('progress', listener);
  return () => { emitter.off('progress', listener); };
}
