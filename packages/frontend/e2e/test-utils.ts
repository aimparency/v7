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

export function seedProject(projectPath: string, data: { phases?: MockPhase[], aims?: MockAim[], meta?: { name?: string, color?: string, statuses?: any[], rootPhaseIds?: string[], dataModelVersion?: number } }) {
  const bowmanPath = join(projectPath, AIMPARENCY_DIR_NAME);
  mkdirSync(join(bowmanPath, 'aims'), { recursive: true });
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

  // Write Aims
  data.aims?.forEach(a => {
    const id = a.id || randomUUID();
    
    const aim = {
      id,
      text: a.text,
      tags: a.tags || [],
      status: {
        state: a.status || 'open',
        comment: '',
        date: Date.now()
      },
      supportingConnections: (a.incoming || []).map(childId => ({ 
        aimId: childId, 
        weight: 1, 
        relativePosition: [0, 0] 
      })),
      supportedAims: a.outgoing || [],
      committedIn: a.committedIn || []
    };

    writeFileSync(join(bowmanPath, 'aims', `${id}.json`), JSON.stringify(aim, null, 2));
  });
}

// Creating an aim can open a follow-up prompt: "Connect to Supported Aim" for
// new phase commitments, "Connection details" for new sub-aims. Waits for the
// Add Aim modal to close, then skips any such prompt with Escape.
export async function finishAimCreation(page: import('@playwright/test').Page) {
  const addAimTitle = page.locator('.modal-panel .modal-header h2', { hasText: 'Add Aim' });
  await addAimTitle.waitFor({ state: 'hidden', timeout: 3000 });
  const followUpPrompt = page.locator('.search-modal, .modal-panel').first();
  try {
    await followUpPrompt.waitFor({ state: 'visible', timeout: 1000 });
  } catch {
    return;
  }
  const cancelButton = page.locator('.modal-panel button', { hasText: 'Cancel' });
  if (await cancelButton.count() > 0) {
    await cancelButton.first().click();
  } else {
    await page.keyboard.press('Escape');
  }
  await followUpPrompt.waitFor({ state: 'hidden', timeout: 3000 });
}
