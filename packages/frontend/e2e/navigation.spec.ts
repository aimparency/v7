import { test, expect } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { seedProject } from './test-utils';
import { randomUUID } from 'crypto';

test.describe('Navigation Tests', () => {
  let tempDir: string;

  test.beforeEach(async ({ page }) => {
    tempDir = join(tmpdir(), 'aimparency-nav-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    // Seed Data
    const phaseId = randomUUID();
    const idea1Id = randomUUID();
    const idea2Id = randomUUID();
    const idea3Id = randomUUID();
    
    const parentAimId = randomUUID();
    const childAimId = randomUUID();

    seedProject(tempDir, {
      phases: [
        { 
          id: phaseId, 
          name: 'Nav Phase', 
          commitments: [idea1Id, idea2Id, idea3Id, parentAimId] 
        }
      ],
      ideas: [
        { id: idea1Id, text: 'Idea 1', committedIn: [phaseId] },
        { id: idea2Id, text: 'Idea 2', committedIn: [phaseId] },
        { id: idea3Id, text: 'Idea 3', committedIn: [phaseId] },
        { 
          id: parentAimId, 
          text: 'Parent Idea', 
          committedIn: [phaseId],
          incoming: [childAimId]
        },
        { id: childAimId, text: 'Child Idea', outgoing: [parentAimId] }
      ]
    });

    await page.goto('/');
    const projectInput = page.locator('.project-input');
    await expect(projectInput).toBeVisible({ timeout: 10000 });
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    await page.waitForSelector('.main-split', { timeout: 20000 });
    await page.waitForTimeout(1000); 
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

  test('Mode Switching and Basic Navigation (j/k)', async ({ page }) => {
    // 1. Initial State: Phase Column selected (Column Nav Mode)
    // The phase 'Nav Phase' should be selected by default as it's the only one (or first).
    // Verify Phase Column has focus style (active)
    // Wait, by default selectPhase selects column 0.
    await expect(page.locator('.column-panel').first()).toHaveClass(/active/);
    
    // Ideas should NOT be active yet
    const getAimItem = (text: string) => 
      page.locator('.idea-item').filter({ 
        has: page.locator('> .idea-content .idea-text', { hasText: text, exact: true }) 
      });

    await expect(getAimItem('Idea 1')).not.toHaveClass(/active/);

    // 2. Enter Idea Navigation Mode (i)
    await page.keyboard.press('i');
    
    // Verify Idea 1 is now selected (default first)
    await expect(getAimItem('Idea 1')).toHaveClass(/active/);
    // Verify Phase Column lost the 'active' class? 
    // Actually uiStore says: column is selected AND navigatingAims is true.
    // PhaseColumn.vue: :class="{ 'active': isActive, ... }"
    // isActive prop comes from PhaseColumn usage in Root.
    // Let's assume visual feedback works. Focus is on ideas.

    // 3. Move Down (j) -> Idea 2
    await page.keyboard.press('j');
    await expect(getAimItem('Idea 2')).toHaveClass(/active/);
    await expect(getAimItem('Idea 1')).not.toHaveClass(/active/);

    // 4. Move Down (j) -> Idea 3
    await page.keyboard.press('j');
    await expect(getAimItem('Idea 3')).toHaveClass(/active/);

    // 5. Move Up (k) -> Idea 2
    await page.keyboard.press('k');
    await expect(getAimItem('Idea 2')).toHaveClass(/active/);

    // 6. Exit Idea Mode (Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    
    // Ideas should lose focus
    await expect(getAimItem('Idea 2')).not.toHaveClass(/active/);
    // Column should have focus
    await expect(page.locator('.column-panel').first()).toHaveClass(/active/);
  });

  test('Expansion and Hierarchy Navigation (l/h)', async ({ page }) => {
    const getAimItem = (text: string) => 
      page.locator('.idea-item').filter({ 
        has: page.locator('> .idea-content .idea-text', { hasText: text, exact: true }) 
      });

    // Enter Idea Mode
    await page.keyboard.press('i');

    // Move down to 'Parent Idea' (4th item: Idea 1, Idea 2, Idea 3, Parent)
    // Actually order depends on seedProject implementation of commitments array.
    // We passed commitments: [idea1Id, idea2Id, idea3Id, parentAimId]
    // So 3 j's.
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    
    await expect(getAimItem('Parent Idea')).toHaveClass(/active/);

    // 1. Expand (l)
    await page.keyboard.press('l');
    await page.waitForTimeout(500); // Wait for load/expand animation

    // Verify Child is visible
    await expect(getAimItem('Child Idea')).toBeVisible();

    // 2. Step in (l again) - l enters the expanded children (j would too: j/k walk the visible rows)
    await page.keyboard.press('l');
    await expect(getAimItem('Child Idea')).toHaveClass(/active/);

    // 3. Step out (h) - returns selection to Parent, which stays expanded
    await page.keyboard.press('h');
    await page.waitForTimeout(200);
    await expect(getAimItem('Parent Idea')).toHaveClass(/active/);

    // 4. Collapse (h again) - hides the children
    await page.keyboard.press('h');
    await page.waitForTimeout(200);
    await expect(getAimItem('Parent Idea')).not.toHaveClass(/expanded/);
    await expect(getAimItem('Child Idea')).not.toBeVisible();
  });
});
