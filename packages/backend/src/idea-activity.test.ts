import { describe, expect, it } from 'vitest';
import { ideaChangeAccessKind, ideaActivitySnapshot, onIdeaAccess, recordIdeaAccess } from './idea-activity.js';
import { emitChange } from './change-events.js';
import { runWithOrigin } from './change-origin.js';

describe('idea activity', () => {
  it('keeps the latest time per kind and announces each access', () => {
    const events: unknown[] = [];
    const stop = onIdeaAccess((event) => events.push(event));
    recordIdeaAccess('/tmp/activity-a', ['idea-1', 'idea-2'], 'found', 1000);
    recordIdeaAccess('/tmp/activity-a', ['idea-1'], 'read', 2000);
    stop();

    expect(ideaActivitySnapshot('/tmp/activity-a')).toEqual({
      'idea-1': { found: 1000, read: 2000 },
      'idea-2': { found: 1000 }
    });
    expect(events).toHaveLength(2);
  });

  it('tells agent writes, agent status changes and manual edits apart', () => {
    const open = { status: { state: 'open' } };
    expect(ideaChangeAccessKind(undefined, open, { ...open, text: 'x' })).toBe('write');
    expect(ideaChangeAccessKind(undefined, open, { status: { state: 'review' } })).toBe('statusChange');
    expect(ideaChangeAccessKind(undefined, null, open)).toBe('write');
    expect(ideaChangeAccessKind('ui-client', open, { status: { state: 'review' } })).toBe('manualEdit');
  });

  it('records idea changes by the origin of the request', () => {
    const projectPath = '/tmp/activity-b';
    emitChange({ type: 'idea', id: 'idea-1', projectPath, entity: { status: { state: 'open' } } as never, previous: null });
    runWithOrigin('ui-client', () =>
      emitChange({ type: 'idea', id: 'idea-2', projectPath, entity: { status: { state: 'open' } } as never, previous: null }));

    const snapshot = ideaActivitySnapshot(projectPath);
    expect(Object.keys(snapshot['idea-1']!)).toEqual(['write']);
    expect(Object.keys(snapshot['idea-2']!)).toEqual(['manualEdit']);
  });
});
