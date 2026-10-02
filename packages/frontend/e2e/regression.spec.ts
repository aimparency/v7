import { test, expect, Page } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { seedProject, finishAimCreation } from './test-utils';
import { randomUUID } from 'crypto';

// Helpers
async function createPhase(page: Page, name: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal-panel', { timeout: 3000 });
  const phaseNameInput = page.locator('input[placeholder="Enter phase name"]');
  await expect(phaseNameInput).toBeVisible();
  await phaseNameInput.fill(name);
  await phaseNameInput.press('Enter');
  await page.waitForSelector('.modal-panel', { state: 'hidden', timeout: 3000 });
}

async function createAim(page: Page, text: string, tags: string[] = []) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal-panel', { timeout: 3000 });
  await page.waitForTimeout(200);
  const ideaInput = page.locator('.modal-panel input[type="text"]').first();
  await expect(ideaInput).toBeVisible();
  await ideaInput.click(); 
  await ideaInput.fill(text);
  
  if (tags.length > 0) {
    const tagInput = page.locator('.modal-panel .area input[type="text"]');
    await expect(tagInput).toBeVisible();
    for (const tag of tags) {
      await tagInput.fill(tag);
      await tagInput.press('Enter');
    }
  }

  await page.waitForTimeout(100); 
  const createBtn = page.locator('.modal-panel button.btn-primary');
  await createBtn.click();
  await finishAimCreation(page);
}

test.describe('Regression Tests', () => {
  let tempDir: string;

  test.beforeEach(async ({ page }) => {
    tempDir = join(tmpdir(), 'aimparency-seed-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    // Seed with comprehensive data
    const phase1Id = randomUUID();
    
    // For Link test
    const ideaFloatingId = randomUUID(); 
    const ideaCommittedId = randomUUID(); 

    // For Move tests
    const ideaMove1Id = randomUUID();
    const ideaMove2Id = randomUUID();
    const ideaMove3Id = randomUUID();

    // For Move Out test
    const ideaParentId = randomUUID();
    const ideaChildId = randomUUID();

    seedProject(tempDir, {
      phases: [
        { 
          id: phase1Id, 
          name: 'Seed Phase 1', 
          commitments: [ideaCommittedId, ideaMove1Id, ideaMove2Id, ideaMove3Id, ideaParentId] 
        }
      ],
      ideas: [
        { id: ideaFloatingId, text: 'Target Floating Idea' },
        { id: ideaCommittedId, text: 'Link Target', committedIn: [phase1Id] },
        
        // Move siblings
        { id: ideaMove1Id, text: 'Move 1', committedIn: [phase1Id] },
        { id: ideaMove2Id, text: 'Move 2', committedIn: [phase1Id] },
        { id: ideaMove3Id, text: 'Move 3', committedIn: [phase1Id] },

        // Nesting
        { id: ideaParentId, text: 'Parent', committedIn: [phase1Id], incoming: [ideaChildId] },
        { id: ideaChildId, text: 'Child', outgoing: [ideaParentId] }
      ]
    });

    await page.goto('/');
    const projectInput = page.locator('.project-input');
    await expect(projectInput).toBeVisible({ timeout: 10000 });
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    await page.waitForSelector('.main-split', { timeout: 20000 });
    await page.waitForTimeout(2000); 
    await page.focus('.app');
  });

  test.afterEach(async () => {
    try {
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  });

  test('Nesting: Add sub-idea of a sub-idea', async ({ page }) => {
    // Navigate to Parent -> Child
    const parent = page.locator('.idea-text', { hasText: 'Parent' });
    await parent.click();
    await page.keyboard.press('l'); // Expand Parent
    await page.waitForTimeout(500); // Wait for fetch

    const child = page.locator('.idea-text', { hasText: 'Child' });
    await expect(child).toBeVisible();
    await child.click();
    
    // Expand Child (it has no children yet, but we set expanded state to create child via 'o')
    await page.keyboard.press('l'); 
    await page.waitForTimeout(200);

    // Create Grandchild
    await createAim(page, 'Grandchild');
    await page.waitForTimeout(500);

    // Verify hierarchy: Parent -> Child -> Grandchild
    // Indentation check via CSS or just visibility
    const grandchild = page.locator('.idea-text', { hasText: 'Grandchild' });
    await expect(grandchild).toBeVisible();
    
    // Ensure it is inside Child's container
    // We can check indentation level by looking at .indent-space width or just structure
    // The structure is .idea-item (Parent) -> .incoming-ideas -> .idea-item (Child) -> .incoming-ideas -> .idea-item (Grandchild)
    
    // Count nested .incoming-ideas containers up to Grandchild
    const hierarchy = page.locator('.idea-item', { hasText: 'Parent' })
      .locator('.incoming-ideas .idea-item', { hasText: 'Child' })
      .locator('.incoming-ideas .idea-item', { hasText: 'Grandchild' });
      
    await expect(hierarchy).toBeVisible();
  });

  test('Linking: Add floating idea as subaim', async ({ page }) => {
    // 1. Verify Floating Idea exists in Root
    await expect(page.locator('.root-ideas-column .idea-text', { hasText: 'Target Floating Idea' })).toBeVisible();

    // 2. Select the committed idea and expand it, so 'o' creates a sub-idea
    await page.locator('.column-panel .idea-text', { hasText: 'Link Target' }).click();
    await page.keyboard.press('l'); // Expand (even if empty)
    await page.waitForTimeout(200);

    // 3. Type the floating idea's name; clicking the matching result links it and submits
    await page.keyboard.press('o');
    await page.waitForSelector('.modal-panel');
    await page.locator('.modal-panel input[type="text"]').first().fill('Target Floating Idea');
    const searchResult = page.locator('.modal-panel .search-results .result-item:not(.additional-option)', { hasText: 'Target Floating Idea' }).first();
    await expect(searchResult).toBeVisible({ timeout: 15000 });
    await searchResult.click();
    await finishAimCreation(page);
    await page.waitForTimeout(500);

    // 4. Verify sub-idea existence
    const subAim = page.locator('.column-panel .incoming-ideas .idea-text', { hasText: 'Target Floating Idea' });
    await expect(subAim).toBeVisible();

    // 5. Verify removed from Floating List
    // Note: Floating list refreshes on scroll or init. Might need to check if it's gone.
    // Infinite scroll logic might keep it until refresh? 
    // Store updates `floatingAims` getter which filters based on committedIn/outgoing.
    // Creating link updates the idea's outgoing. So it should disappear reactively.
    await expect(page.locator('.root-ideas-column .idea-text', { hasText: 'Target Floating Idea' })).toBeHidden();
  });

  test('Move: J/K reordering', async ({ page }) => {
    // Initial: Move 1, Move 2, Move 3
    // Select Move 2
    const move2 = page.locator('.column-panel .idea-text', { hasText: 'Move 2' });
    await move2.click();

    // Move Up (K) -> 2, 1, 3
    await page.keyboard.press('K');
    await page.waitForTimeout(500); // Wait for sync

    const ideasAfterUp = await page.locator('.column-panel .idea-text').allTextContents().then(texts => texts.map(text => text.trim()));
    // Filter to just our move ideas
    const moveAimsUp = ideasAfterUp.filter(t => t.includes('Move'));
    // Should be 2, 1, 3
    expect(moveAimsUp[0]).toBe('Move 2');
    expect(moveAimsUp[1]).toBe('Move 1');
    expect(moveAimsUp[2]).toBe('Move 3');

    // Move Down (J) -> 1, 2, 3
    await page.keyboard.press('J');
    await page.waitForTimeout(500);

    const ideasAfterDown = await page.locator('.column-panel .idea-text').allTextContents().then(texts => texts.map(text => text.trim()));
    const moveAimsDown = ideasAfterDown.filter(t => t.includes('Move'));
    expect(moveAimsDown[0]).toBe('Move 1');
    expect(moveAimsDown[1]).toBe('Move 2');
    expect(moveAimsDown[2]).toBe('Move 3');
  });

  test('Move In (L): Indent idea', async ({ page }) => {
    // Initial: Move 1, Move 2
    // Select Move 2
    const move2 = page.locator('.column-panel .idea-text', { hasText: 'Move 2' });
    await move2.click();

    // Indent (L) -> Move 1 > Move 2
    await page.keyboard.press('L');
    await page.waitForTimeout(500);

    // Verify Move 2 is inside Move 1
    const nestedMove2 = page.locator('.idea-item', { hasText: 'Move 1' })
      .locator('.incoming-ideas .idea-text', { hasText: 'Move 2' });
    await expect(nestedMove2).toBeVisible();
  });

  test('Move Out (H): Un-indent idea', async ({ page }) => {
    // Initial: Parent > Child
    // Select Child
    const parent = page.locator('.column-panel .idea-text', { hasText: 'Parent' });
    await parent.click();
    await page.keyboard.press('l'); // Expand
    await page.waitForTimeout(200);
    
    const child = page.locator('.column-panel .idea-text', { hasText: 'Child' });
    await child.click();

    // Un-indent (H)
    await page.keyboard.press('H');
    await page.waitForTimeout(500);

    // Verify Parent and Child are siblings
    // Both should be visible at top level of phase (checking indent level 0)
    // We can check that Child is NOT inside Parent's incoming-ideas
    const nestedChild = page.locator('.idea-item', { hasText: 'Parent' })
      .locator('.incoming-ideas .idea-text', { hasText: 'Child' });
    await expect(nestedChild).toBeHidden();

    // And Child is visible
    await expect(page.locator('.column-panel .idea-text', { hasText: 'Child' })).toBeVisible();
  });
});
