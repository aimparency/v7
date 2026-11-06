import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { AIMPARENCY_DIR_NAME, CURRENT_DATA_MODEL_VERSION, INITIAL_STATES } from 'shared';

export interface MockIdea {
  id?: string;
  text: string;
  status?: string;
  tags?: string[];
  // Ideas supporting this one (its sub-ideas), and ideas it supports.
  supportingIdeaIds?: string[];
  supportedIdeaIds?: string[];
  committedIn?: string[];
}

export interface MockPhase {
  id?: string;
  name: string;
  commitments?: string[];
  parent?: string | null;
  childPhaseIds?: string[];
}

// Writes a project in the current data model. Phase order not given explicitly
// follows the seed order: roots into meta.rootPhaseIds, children into their
// parent's childPhaseIds.
export function seedProject(projectPath: string, data: { phases?: MockPhase[], ideas?: MockIdea[], meta?: { name?: string, color?: string, statuses?: any[], rootPhaseIds?: string[], dataModelVersion?: number } }) {
  const bowmanPath = join(projectPath, AIMPARENCY_DIR_NAME);
  mkdirSync(join(bowmanPath, 'ideas'), { recursive: true });
  mkdirSync(join(bowmanPath, 'phases'), { recursive: true });

  const phases = (data.phases ?? []).map((p) => ({ ...p, id: p.id || randomUUID(), parent: p.parent || null }));
  const childIdsOf = (parentId: string | null) => phases.filter((p) => p.parent === parentId).map((p) => p.id);

  writeFileSync(join(bowmanPath, 'meta.json'), JSON.stringify({
    name: data.meta?.name || 'Test Project',
    color: data.meta?.color || '#ff0000',
    statuses: data.meta?.statuses ?? INITIAL_STATES,
    rootPhaseIds: data.meta?.rootPhaseIds || childIdsOf(null),
    dataModelVersion: data.meta?.dataModelVersion ?? CURRENT_DATA_MODEL_VERSION
  }, null, 2));

  phases.forEach((p) => {
    const phase = {
      id: p.id,
      name: p.name,
      parent: p.parent,
      childPhaseIds: p.childPhaseIds || childIdsOf(p.id),
      commitments: p.commitments || []
    };
    writeFileSync(join(bowmanPath, 'phases', `${p.id}.json`), JSON.stringify(phase, null, 2));
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
      supportingConnections: (a.supportingIdeaIds || []).map(childId => ({ 
        ideaId: childId, 
        weight: 1, 
        relativePosition: [0, 0] 
      })),
      supportedIdeas: a.supportedIdeaIds || [],
      committedIn: a.committedIn || []
    };

    writeFileSync(join(bowmanPath, 'ideas', `${id}.json`), JSON.stringify(idea, null, 2));
  });
}

// Opens a project from the project selection screen and waits for the main view.
export async function openProject(page: import('@playwright/test').Page, projectPath: string) {
  await page.goto('/');
  const projectInput = page.locator('.project-input');
  await projectInput.waitFor({ state: 'visible', timeout: 10000 });
  await projectInput.fill(projectPath);
  await projectInput.press('Enter');
  await page.waitForSelector('.main-split', { timeout: 20000 });
  await page.locator('#project-load-screen').waitFor({ state: 'hidden', timeout: 30000 });
}

// Creating an idea can open follow-up prompts: "Connect to Supported Idea" for
// new phase commitments, "Connection details" for new sub-ideas, and "Commit to
// Phase" for new graph ideas (possibly one after another). Waits for the Add Idea
// modal to close, then skips each prompt until none is left.
export async function finishIdeaCreation(page: import('@playwright/test').Page) {
  const addIdeaTitle = page.locator('.modal-panel .modal-header h2', { hasText: 'Add Idea' });
  await addIdeaTitle.waitFor({ state: 'hidden', timeout: 3000 });
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
