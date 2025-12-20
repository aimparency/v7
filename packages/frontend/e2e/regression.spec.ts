import { test, expect, Page } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { seedProject } from './test-utils';
import { randomUUID } from 'crypto';

// Helpers
async function createPhase(page: Page, name: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal', { timeout: 3000 });
  const phaseNameInput = page.locator('input[placeholder="Enter phase name"]');
  await expect(phaseNameInput).toBeVisible();
  await phaseNameInput.fill(name);
  await phaseNameInput.press('Enter');
  await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
}

async function createAim(page: Page, text: string, tags: string[] = []) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal', { timeout: 3000 });
  await page.waitForTimeout(200);
  const aimInput = page.locator('.modal input[type="text"]').first();
  await expect(aimInput).toBeVisible();
  await aimInput.click(); 
  await aimInput.fill(text);
  
  if (tags.length > 0) {
    const tagInput = page.locator('.modal .area input[type="text"]');
    await expect(tagInput).toBeVisible();
    for (const tag of tags) {
      await tagInput.fill(tag);
      await tagInput.press('Enter');
    }
  }

  await page.waitForTimeout(100); 
  const createBtn = page.locator('.modal button.btn-primary');
  await createBtn.click();
  await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
}

test.describe('Regression Tests', () => {
  let tempDir: string;

  test.beforeEach(async ({ page }) => {
    tempDir = join(tmpdir(), 'aimparency-seed-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    // Seed with comprehensive data
    const phase1Id = randomUUID();
    
    // For Link test
    const aimFloatingId = randomUUID(); 
    const aimCommittedId = randomUUID(); 

    // For Move tests
    const aimMove1Id = randomUUID();
    const aimMove2Id = randomUUID();
    const aimMove3Id = randomUUID();

    // For Move Out test
    const aimParentId = randomUUID();
    const aimChildId = randomUUID();

    seedProject(tempDir, {
      phases: [
        { 
          id: phase1Id, 
          name: 'Seed Phase 1', 
          commitments: [aimCommittedId, aimMove1Id, aimMove2Id, aimMove3Id, aimParentId] 
        }
      ],
      aims: [
        { id: aimFloatingId, text: 'Target Floating Aim' },
        { id: aimCommittedId, text: 'Link Target', committedIn: [phase1Id] },
        
        // Move siblings
        { id: aimMove1Id, text: 'Move 1', committedIn: [phase1Id] },
        { id: aimMove2Id, text: 'Move 2', committedIn: [phase1Id] },
        { id: aimMove3Id, text: 'Move 3', committedIn: [phase1Id] },

        // Nesting
        { id: aimParentId, text: 'Parent', committedIn: [phase1Id], incoming: [aimChildId] },
        { id: aimChildId, text: 'Child', outgoing: [aimParentId] }
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

  test('Nesting: Add sub-aim of a sub-aim', async ({ page }) => {
    // Navigate to Parent -> Child
    const parent = page.locator('.aim-text', { hasText: 'Parent' });
    await parent.click();
    await page.keyboard.press('l'); // Expand Parent
    await page.waitForTimeout(500); // Wait for fetch

    const child = page.locator('.aim-text', { hasText: 'Child' });
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
    const grandchild = page.locator('.aim-text', { hasText: 'Grandchild' });
    await expect(grandchild).toBeVisible();
    
    // Ensure it is inside Child's container
    // We can check indentation level by looking at .indent-space width or just structure
    // The structure is .aim-item (Parent) -> .incoming-aims -> .aim-item (Child) -> .incoming-aims -> .aim-item (Grandchild)
    
    // Count nested .incoming-aims containers up to Grandchild
    const hierarchy = page.locator('.aim-item', { hasText: 'Parent' })
      .locator('.incoming-aims .aim-item', { hasText: 'Child' })
      .locator('.incoming-aims .aim-item', { hasText: 'Grandchild' });
      
    await expect(hierarchy).toBeVisible();
  });

  test('Linking: Add floating aim as subaim', async ({ page }) => {
    // 1. Verify Floating Aim exists in Root
    await expect(page.locator('.root-aims-column .aim-text', { hasText: 'Target Floating Aim' })).toBeVisible();

    // 2. Select Committed Aim
    await page.locator('.phase-column .aim-text', { hasText: 'Link Target' }).click();

    // 3. Open Create Modal
    await page.keyboard.press('o');
    await page.waitForSelector('.modal');

    // Wait a bit for any background indexing/embeddings
    await page.waitForTimeout(3000);

    // 4. Type Name of Floating Aim
    const input = page.locator('.modal input[type="text"]').first();
    await input.click();
    await input.type('Target Floating Aim', { delay: 100 });
    
    // Wait for search results container to appear and populate
    try {
      await page.waitForSelector('.search-result.existing-aim', { timeout: 15000 });
    } catch (e) {
      console.log('Timeout waiting for search results. Current input value:', await page.locator('.modal input[type="text"]').first().inputValue());
      throw e;
    }

    // 5. Select from Search Results (click first result)
    const searchResult = page.locator('.search-result.existing-aim').first();
    await expect(searchResult).toBeVisible();
    await expect(searchResult).toContainText('Target Floating Aim');
    await searchResult.click();

    // 6. Submit (Link Existing)
    await page.locator('.modal button.btn-primary').click();
    await page.waitForSelector('.modal', { state: 'hidden' });
    await page.waitForTimeout(500);

    // 7. Verify it is now a sub-aim
    // Need to expand 'Link Target' if not already
    // Since we used 'o', it might just be inserted. 
    // Wait, 'o' creates sibling by default unless expanded?
    // If 'Link Target' was not expanded, we created a SIBLING.
    // To create a sub-aim, we should have expanded 'Link Target' first OR used 'o' on an expanded aim.
    // BUT 'createAim' logic in store:
    // If path.aims.length > 0 (we selected 'Link Target'):
    // If currentAim.expanded && insertPosition == 'after' -> Create Sub-aim.
    // Else -> Create Sibling.
    
    // So we need to Expand 'Link Target' first!
    // Let's retry logic:
    
    // Reset interaction
    await page.reload(); 
    await page.waitForSelector('.main-split');
    
    await page.locator('.phase-column .aim-text', { hasText: 'Link Target' }).click();
    await page.keyboard.press('l'); // Expand (even if empty)
    await page.waitForTimeout(200);
    
    await page.keyboard.press('o'); // Now it should create sub-aim
    await page.locator('.modal input[type="text"]').first().fill('Target Floating Aim');
    await page.waitForTimeout(500);
    await page.locator('.search-result.existing-aim').first().click();
    await page.locator('.modal button.btn-primary').click();
    await page.waitForSelector('.modal', { state: 'hidden' });
    await page.waitForTimeout(500);

    // 8. Verify sub-aim existence
    const subAim = page.locator('.phase-column .incoming-aims .aim-text', { hasText: 'Target Floating Aim' });
    await expect(subAim).toBeVisible();

    // 9. Verify removed from Floating List
    // Note: Floating list refreshes on scroll or init. Might need to check if it's gone.
    // Infinite scroll logic might keep it until refresh? 
    // Store updates `floatingAims` getter which filters based on committedIn/outgoing.
    // Creating link updates the aim's outgoing. So it should disappear reactively.
    await expect(page.locator('.root-aims-column .aim-text', { hasText: 'Target Floating Aim' })).toBeHidden();
  });

  test('Move: J/K reordering', async ({ page }) => {
    // Initial: Move 1, Move 2, Move 3
    // Select Move 2
    const move2 = page.locator('.phase-column .aim-text', { hasText: 'Move 2' });
    await move2.click();

    // Move Up (K) -> 2, 1, 3
    await page.keyboard.press('K');
    await page.waitForTimeout(500); // Wait for sync

    const aimsAfterUp = await page.locator('.phase-column .aim-text').allTextContents();
    // Filter to just our move aims
    const moveAimsUp = aimsAfterUp.filter(t => t.includes('Move'));
    // Should be 2, 1, 3
    expect(moveAimsUp[0]).toBe('Move 2');
    expect(moveAimsUp[1]).toBe('Move 1');
    expect(moveAimsUp[2]).toBe('Move 3');

    // Move Down (J) -> 1, 2, 3
    await page.keyboard.press('J');
    await page.waitForTimeout(500);

    const aimsAfterDown = await page.locator('.phase-column .aim-text').allTextContents();
    const moveAimsDown = aimsAfterDown.filter(t => t.includes('Move'));
    expect(moveAimsDown[0]).toBe('Move 1');
    expect(moveAimsDown[1]).toBe('Move 2');
    expect(moveAimsDown[2]).toBe('Move 3');
  });

  test('Move In (L): Indent aim', async ({ page }) => {
    // Initial: Move 1, Move 2
    // Select Move 2
    const move2 = page.locator('.phase-column .aim-text', { hasText: 'Move 2' });
    await move2.click();

    // Indent (L) -> Move 1 > Move 2
    await page.keyboard.press('L');
    await page.waitForTimeout(500);

    // Verify Move 2 is inside Move 1
    const nestedMove2 = page.locator('.aim-item', { hasText: 'Move 1' })
      .locator('.incoming-aims .aim-text', { hasText: 'Move 2' });
    await expect(nestedMove2).toBeVisible();
  });

  test('Move Out (H): Un-indent aim', async ({ page }) => {
    // Initial: Parent > Child
    // Select Child
    const parent = page.locator('.phase-column .aim-text', { hasText: 'Parent' });
    await parent.click();
    await page.keyboard.press('l'); // Expand
    await page.waitForTimeout(200);
    
    const child = page.locator('.phase-column .aim-text', { hasText: 'Child' });
    await child.click();

    // Un-indent (H)
    await page.keyboard.press('H');
    await page.waitForTimeout(500);

    // Verify Parent and Child are siblings
    // Both should be visible at top level of phase (checking indent level 0)
    // We can check that Child is NOT inside Parent's incoming-aims
    const nestedChild = page.locator('.aim-item', { hasText: 'Parent' })
      .locator('.incoming-aims .aim-text', { hasText: 'Child' });
    await expect(nestedChild).toBeHidden();

    // And Child is visible
    await expect(page.locator('.phase-column .aim-text', { hasText: 'Child' })).toBeVisible();
  });
});
