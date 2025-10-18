import { test, expect, Page } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

async function createPhase(page: Page, name: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal', { timeout: 3000 });
  const phaseNameInput = page.locator('input[placeholder="Enter phase name"]');
  await expect(phaseNameInput).toBeVisible();
  await phaseNameInput.fill(name);
  await phaseNameInput.press('Enter');
  await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
}

// See here how to get started:
// https://playwright.dev/docs/intro
test('visits the app root url', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Aimparency');
})

test('sub-phase selection persistence', async ({ page }) => {
  /*
   * Create temp folder, 
   * open web ui
   * enter temp folder and open project
   * press l to go to root aims
   * create phase A (o) 
   * press l again to go to As sub phases
   * create sub phase A.1
   * create sub phase A.2
   * press j to make sure we go down to sub phase selection index 1.
   * press h to go to root phase page
   * create phase B (o)
   * create two sub phases too. 
   * press k to make sure we go up. 
   * Then go back to the other sub phases: h k l. 
   * And check that still the last item is selected. 
   */

  // Create a temporary directory for the test project
  const tempDir = join(tmpdir(), 'aimparency-test-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    // Navigate to the app
    await page.goto('/');

    // Wait for the project selection screen
    await page.waitForSelector('.project-selection', { timeout: 10000 });

    // Enter the temporary project path
    const projectInput = page.locator('.project-input');
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    // Wait for the project to load
    await page.waitForSelector('.main', { timeout: 10000 });

    // Wait a bit for the backend to initialize
    await page.waitForTimeout(1000);

    // Focus the app for keyboard navigation
    await page.focus('.app');

    // Initially we're in root aims column (column 0), need to go to phase column (column 1) to create phases
    await page.keyboard.press('l'); // Navigate right to phase column

    // Create first root phase (Phase A)
    await createPhase(page, 'Phase A');

    // Navigate to Phase A's sub-phases
    await page.keyboard.press('l'); // Enter Phase A's sub-phases

    // Create first sub-phase for Phase A
    await createPhase(page, 'Sub A1');
    await expect(page.locator('.main .phase-container.selected-outlined')).toHaveText(/Sub A1/);

    // Create second sub-phase for Phase A
    await createPhase(page, 'Sub A2');
    await expect(page.locator('.main .phase-container.selected-outlined')).toHaveText(/Sub A2/);

    // Go back to root phases
    await page.keyboard.press('h'); // Go back to root

    // Create second root phase (Phase B)
    await createPhase(page, 'Phase B');

    // Navigate to Phase B's sub-phases
    await page.keyboard.press('l'); // Enter Phase B's sub-phases

    // Create first sub-phase for Phase B
    for(let i = 0; i < 3; i++) {
      await createPhase(page, `Sub B${i + 1}`);
      await expect(page.locator('.main .phase-container.selected-outlined')).toHaveText(new RegExp(`Sub B${i + 1}`));
    }

    // Navigate back: h (to column 1), k (to Phase A)
    await page.keyboard.press('h'); // Go back to root phases (column 1)

    // Verify Phase B is selected (we're at column 1, Phase B is the last created phase, index 1)
    await expect(page.locator('.column-1 .phase-container.selected-outlined')).toHaveText(/Phase B/);

    // Now select Phase A with k
    await page.keyboard.press('k'); // Select Phase A (index 0)

    // Verify Phase A is selected BEFORE entering its children
    await expect(page.locator('.column-1 .phase-container.selected-outlined')).toHaveText(/Phase A/);

    // Verify Sub A2 is already visible in column 2 (because column 2 is visible via teleport)
    // Column 2 should show Phase A's children with Sub A2 selected
    await expect(page.locator('.main .phase-list').nth(1)).toBeVisible();
    await expect(page.locator('.main .phase-list').nth(1).locator('.phase-container.selected')).toHaveText(/Sub A2/);

    // Enter Phase A's sub-phases - this should focus column 2
    await page.keyboard.press('l'); // Enter Phase A's sub-phases (column 2 becomes active)

    // Verify Sub A2 is STILL selected AFTER entering the column (now with active state)
    await expect(page.locator('.main .phase-container.selected-outlined')).toHaveText(/Sub A2/);

  } finally {
    // Clean up temporary directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);

    }
  }
});
