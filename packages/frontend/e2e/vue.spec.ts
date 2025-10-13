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
  await expect(page.locator('h1')).toHaveText('You did it!');
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

    // Create second sub-phase for Phase A
    await createPhase(page, 'Sub A2');

    // Select Sub A2 (should be index 1)
    await page.keyboard.press('j'); // Select Sub A2

    // Verify Sub A2 is selected
    await expect(page.locator('.column-2 .phase-container.selected-outlined')).toHaveText(/Sub A2/);

    // Go back to root phases
    await page.keyboard.press('h'); // Go back to root

    // Create second root phase (Phase B)
    await createPhase(page, 'Phase B');

    // Navigate to Phase B's sub-phases
    await page.keyboard.press('l'); // Enter Phase B's sub-phases

    // Create first sub-phase for Phase B
    await createPhase(page, 'Sub B1');

    // Create second sub-phase for Phase B
    await createPhase(page, 'Sub B2');

    // Select Sub B2 (should be index 1)
    await page.keyboard.press('j'); // Select Sub B2

    // Verify Sub B2 is selected
    await expect(page.locator('.column-2 .phase-container.selected-outlined')).toHaveText(/Sub B2/);

    // Go back to root phases
    await page.keyboard.press('h'); // Go back to root

    // Navigate back to Phase A
    await page.keyboard.press('k'); // Select Phase A

    // Verify Phase A is selected
    await expect(page.locator('.column-1 .phase-container.selected-outlined')).toHaveText(/Phase A/);

    // Enter Phase A's sub-phases - should select Sub A2 (remembered selection)
    await page.keyboard.press('l'); // Enter Phase A's sub-phases

    // Verify we're in column 2
    await expect(page.locator('.column-2')).toBeVisible();

    // Check that Sub A2 is selected (the remembered selection for Phase A)
    const selectedSubPhaseA = page.locator('.column-2 .phase-container.selected-outlined');
    await expect(selectedSubPhaseA).toHaveText(/Sub A2/);

  } finally {
    // Clean up temporary directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  }
});
