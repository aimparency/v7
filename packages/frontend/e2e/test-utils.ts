import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { AIMPARENCY_DIR_NAME } from 'shared';

export interface MockAim {
  id?: string;
  text: string;
  status?: string;
  tags?: string[];
  incoming?: string[];
  outgoing?: string[];
  committedIn?: string[];
}

export interface MockPhase {
  id?: string;
  name: string;
  commitments?: string[];
  parent?: string | null;
  childPhaseIds?: string[];
}

export function seedProject(projectPath: string, data: { phases?: MockPhase[], ideas?: MockAim[], meta?: { name?: string, color?: string, statuses?: any[], rootPhaseIds?: string[], dataModelVersion?: number } }) {
  const bowmanPath = join(projectPath, AIMPARENCY_DIR_NAME);
  mkdirSync(join(bowmanPath, 'ideas'), { recursive: true });
  mkdirSync(join(bowmanPath, 'phases'), { recursive: true });

  // Write Meta
  writeFileSync(join(bowmanPath, 'meta.json'), JSON.stringify({
    name: data.meta?.name || 'Test Project',
    color: data.meta?.color || '#ff0000',
    statuses: data.meta?.statuses || [],
    rootPhaseIds: data.meta?.rootPhaseIds || [],
    dataModelVersion: data.meta?.dataModelVersion ?? 2
  }, null, 2));

  // Write Phases
  const phaseMap = new Map<string, string>(); // Name -> ID
  
  data.phases?.forEach(p => {
    const id = p.id || randomUUID();
    phaseMap.set(p.name, id);
    
    const phase = {
      id,
      name: p.name,
      parent: p.parent || null,
      childPhaseIds: p.childPhaseIds || [],
      commitments: p.commitments || []
    };
    
    writeFileSync(join(bowmanPath, 'phases', `${id}.json`), JSON.stringify(phase, null, 2));
  });

  // Write Ideas
  data.ideas?.forEach(a => {
    const id = a.id || randomUUID();
    
    const idea = {
      id,
      text: a.text,
      tags: a.tags || [],
      status: {
        state: a.status || 'open',
        comment: '',
        date: Date.now()
      },
      supportingConnections: (a.incoming || []).map(childId => ({ 
        ideaId: childId, 
        weight: 1, 
        relativePosition: [0, 0] 
      })),
      supportedAims: a.outgoing || [],
      committedIn: a.committedIn || []
    };

    writeFileSync(join(bowmanPath, 'ideas', `${id}.json`), JSON.stringify(idea, null, 2));
  });
}

// Creating an idea can open follow-up prompts: "Connect to Supported Idea" for
// new phase commitments, "Connection details" for new sub-ideas, and "Commit to
// Phase" for new graph ideas (possibly one after another). Waits for the Add Idea
// modal to close, then skips each prompt until none is left.
export async function finishAimCreation(page: import('@playwright/test').Page) {
  const addAimTitle = page.locator('.modal-panel .modal-header h2', { hasText: 'Add Idea' });
  await addAimTitle.waitFor({ state: 'hidden', timeout: 3000 });
  const followUpPrompt = page.locator('.search-modal, .modal-panel').first();
  for (let prompt = 0; prompt < 3; prompt++) {
    try {
      await followUpPrompt.waitFor({ state: 'visible', timeout: 1500 });
    } catch {
      return;
    }
    const cancelButton = page.locator('.modal-panel button', { hasText: 'Cancel' });
    if (await cancelButton.count() > 0) {
      await cancelButton.first().click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(300);
  }
  await followUpPrompt.waitFor({ state: 'hidden', timeout: 3000 });
}
