import { test, expect, Page } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { seedProject } from './test-utils';
import { randomUUID } from 'crypto';

test.describe('Sub-phase Navigation', () => {
  let tempDir: string;

  test.beforeEach(async ({ page }) => {
    tempDir = join(tmpdir(), 'aimparency-subphase-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    // Seed: Phase A -> Phase B -> Phase C -> Aim Target
    const rootPhaseId = randomUUID();
    const subPhaseId = randomUUID();
    const subSubPhaseId = randomUUID();
    const targetAimId = randomUUID();

    seedProject(tempDir, {
      phases: [
        { 
          id: rootPhaseId, 
          name: 'Root Phase', 
          parent: null 
        },
        { 
          id: subPhaseId, 
          name: 'Sub Phase', 
          parent: rootPhaseId
        },
        { 
          id: subSubPhaseId, 
          name: 'Sub Sub Phase', 
          parent: subPhaseId,
          commitments: [targetAimId]
        }
      ],
      aims: [
        { 
          id: targetAimId, 
          text: 'Target Aim', 
          committedIn: [subSubPhaseId] 
        }
      ]
    });

    await page.goto('/');
    const projectInput = page.locator('.project-input');
    await expect(projectInput).toBeVisible({ timeout: 10000 });
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    await page.waitForSelector('.main-split', { timeout: 20000 });
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

  test('Navigate to aim in sub-phase', async ({ page }) => {
    // Initial state: Root Phase should be visible.
    await expect(page.locator('.phase-column').first()).toContainText('Root Phase');

    // Search for Target Aim
    await page.keyboard.type('/');
    await page.getByPlaceholder('Go to aim...').fill('Target Aim');
    
    // Wait for results
    await expect(page.locator('.result-item').first()).toContainText('Target Aim');
    
    // Select it
    await page.keyboard.press('Enter');
    
    // Wait for modal to close
    await expect(page.locator('.search-modal')).toBeHidden();

    // Verify:
    // 1. Target Aim is visible in the column
    const targetAim = page.locator('.phase-column .aim-text', { hasText: 'Target Aim' });
    await expect(targetAim).toBeVisible();

    // 2. Check Columns specifically
    const columns = page.locator('.phase-column');
    
    // Column 0: Root Phase
    await expect(columns.nth(0).locator('.phase-container', { hasText: 'Root Phase' })).toBeVisible();
    
    // Column 1: Sub Phase (Scope to column 1 to avoid matching Sub Sub Phase in col 2)
    await expect(columns.nth(1).locator('.phase-name', { hasText: 'Sub Phase' })).toBeVisible();

    // Column 2: Sub Sub Phase
    await expect(columns.nth(2).locator('.phase-name', { hasText: 'Sub Sub Phase' })).toBeVisible();

    // 3. Ensure hierarchy text is present (double check)
    await expect(columns.nth(0)).toContainText('Root Phase');
    await expect(columns.nth(1)).toContainText('Sub Phase');
    await expect(columns.nth(2)).toContainText('Sub Sub Phase');
  });
});
