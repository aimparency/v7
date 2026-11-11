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

  it('keeps only the most recently touched ideas', () => {
    const ids = Array.from({ length: 20_005 }, (_, index) => `idea-${index}`);
    recordIdeaAccess('/tmp/activity-bounded', ids, 'found', 1000);
    recordIdeaAccess('/tmp/activity-bounded', ['idea-0'], 'read', 2000);
    const snapshot = ideaActivitySnapshot('/tmp/activity-bounded');
    expect(Object.keys(snapshot)).toHaveLength(20_000);
    expect(snapshot['idea-0']).toEqual({ read: 2000 }); // evicted, then recorded anew
    expect(snapshot['idea-5']).toBeUndefined();
    expect(snapshot['idea-20004']).toEqual({ found: 1000 });
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
