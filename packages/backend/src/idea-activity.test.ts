import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addAccess } from 'shared';
import { ideaChangeAccessKind, ideaActivitySnapshot, loadIdeaActivity, onIdeaAccess, recordIdeaAccess, saveIdeaActivity } from './idea-activity.js';
import { emitChange } from './change-events.js';
import { runWithOrigin } from './change-origin.js';

describe('idea activity', () => {
  it('adds up accesses per kind and announces each one, numbered', () => {
    const events: { seq: number }[] = [];
    const stop = onIdeaAccess((event) => events.push(event));
    recordIdeaAccess('/tmp/activity-a', ['idea-1', 'idea-2'], 'found', 1000);
    recordIdeaAccess('/tmp/activity-a', ['idea-1'], 'read', 2000);
    recordIdeaAccess('/tmp/activity-a', ['idea-1'], 'read', 3000);
    stop();

    const snapshot = ideaActivitySnapshot('/tmp/activity-a');
    expect(snapshot.ideas).toEqual({
      'idea-1': addAccess(addAccess(addAccess(undefined, 'found', 1000), 'read', 2000), 'read', 3000),
      'idea-2': addAccess(undefined, 'found', 1000)
    });
    expect(events.map((event) => event.seq - events[0]!.seq)).toEqual([0, 1, 2]);
    expect(snapshot.seq).toBe(events[2]!.seq);
  });

  it('keeps only the most recently touched ideas', () => {
    const ids = Array.from({ length: 20_005 }, (_, index) => `idea-${index}`);
    recordIdeaAccess('/tmp/activity-bounded', ids, 'found', 1000);
    recordIdeaAccess('/tmp/activity-bounded', ['idea-0'], 'read', 2000);
    const { ideas } = ideaActivitySnapshot('/tmp/activity-bounded');
    expect(Object.keys(ideas)).toHaveLength(20_000);
    expect(ideas['idea-0']).toEqual(addAccess(undefined, 'read', 2000)); // evicted, then recorded anew
    expect(ideas['idea-5']).toBeUndefined();
    expect(ideas['idea-20004']).toEqual(addAccess(undefined, 'found', 1000));
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

    const snapshot = ideaActivitySnapshot(projectPath).ideas;
    expect(Object.keys(snapshot['idea-1']!)).toEqual(['write']);
    expect(Object.keys(snapshot['idea-2']!)).toEqual(['manualEdit']);
  });

  it('survives a restart through the runtime file, without what has faded', () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-file-'));
    const now = 10 * 24 * 3600_000;
    const activity = new Map([
      ['fresh', addAccess(addAccess(undefined, 'found', now - 60_000), 'write', now - 60_000)],
      // A 'found' a day ago faded long ago; its recent write still shows.
      ['mixed', addAccess(addAccess(undefined, 'found', now - 24 * 3600_000), 'write', now - 60_000)],
      ['faded', addAccess(undefined, 'read', now - 24 * 3600_000)]
    ]);
    saveIdeaActivity(projectPath, activity, now);

    const loaded = loadIdeaActivity(projectPath);
    expect([...loaded.keys()].sort()).toEqual(['fresh', 'mixed']);
    expect(Object.keys(loaded.get('mixed')!)).toEqual(['write']);
    expect(loaded.get('fresh')).toEqual(activity.get('fresh'));
    expect(loadIdeaActivity(path.join(projectPath, 'missing')).size).toBe(0);
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
});
