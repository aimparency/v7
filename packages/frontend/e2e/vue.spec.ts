import { test, expect } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

// See here how to get started:
// https://playwright.dev/docs/intro
test('visits the app root url', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('You did it!');
})

test('sub-phase selection persistence', async ({ page }) => {
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

    // Initially we're in root aims column (column 0), need to go to phase column (column 1) to create phases
    await page.keyboard.press('l'); // Navigate right to phase column

    // Create first root phase
    await page.keyboard.press('o');
    await page.waitForSelector('.modal', { timeout: 3000 });
    const phaseNameInput = page.locator('input[placeholder="Enter phase name"]');
    await expect(phaseNameInput).toBeVisible();
    await phaseNameInput.fill('Phase A');
    await phaseNameInput.press('Enter');

    // Wait for modal to close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });

    // Create second root phase
    await page.keyboard.press('o');
    await page.waitForSelector('.modal', { timeout: 3000 });
    await expect(phaseNameInput).toBeVisible();
    await phaseNameInput.fill('Phase B');
    await phaseNameInput.press('Enter');

    // Wait for modal to close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });

    // Navigate to first phase (Phase A)
    await page.keyboard.press('j'); // Select Phase A

    // Create first sub-phase for Phase A
    await page.keyboard.press('o');
    await page.waitForSelector('.modal', { timeout: 3000 });
    await expect(phaseNameInput).toBeVisible();
    await phaseNameInput.fill('Sub A1');
    await phaseNameInput.press('Enter');

    // Wait for modal to close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });

    // Create second sub-phase for Phase A
    await page.keyboard.press('o');
    await page.waitForSelector('.modal', { timeout: 3000 });
    await expect(phaseNameInput).toBeVisible();
    await phaseNameInput.fill('Sub A2');
    await phaseNameInput.press('Enter');

    // Wait for modal to close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });

    // Navigate to second phase (Phase B)
    await page.keyboard.press('h'); // Go back to root
    await page.keyboard.press('j'); // Select Phase B

    // Create first sub-phase for Phase B
    await page.keyboard.press('o');
    await page.waitForSelector('.modal', { timeout: 3000 });
    await expect(phaseNameInput).toBeVisible();
    await phaseNameInput.fill('Sub B1');
    await phaseNameInput.press('Enter');

    // Wait for modal to close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });

    // Create second sub-phase for Phase B
    await page.keyboard.press('o');
    await page.waitForSelector('.modal', { timeout: 3000 });
    await expect(phaseNameInput).toBeVisible();
    await phaseNameInput.fill('Sub B2');
    await phaseNameInput.press('Enter');

    // Wait for modal to close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });

    // Now test the selection persistence
    // Go to Phase A and select its second sub-phase (Sub A2)
    await page.keyboard.press('h'); // Go back to root
    await page.keyboard.press('k'); // Select Phase A
    await page.keyboard.press('l'); // Enter Phase A's sub-phases
    await page.keyboard.press('j'); // Select Sub A2 (second sub-phase)

    // Go back to root and switch to Phase B
    await page.keyboard.press('h'); // Go back to root
    await page.keyboard.press('j'); // Select Phase B

    // Enter Phase B's sub-phases - should NOT select Sub B2 (same index as Sub A2)
    await page.keyboard.press('l'); // Enter Phase B's sub-phases

    // Check that the first sub-phase (Sub B1) is selected, not Sub B2
    const selectedSubPhase = page.locator('.column-2 .phase-container.selected-outlined');
    await expect(selectedSubPhase).toHaveText(/Sub B1/);

    // Now select Sub B2 explicitly for Phase B
    await page.keyboard.press('j'); // Select Sub B2

    // Go back to Phase A
    await page.keyboard.press('h'); // Go back to root
    await page.keyboard.press('k'); // Select Phase A

    // Enter Phase A's sub-phases - should select Sub A2 (remembered selection)
    await page.keyboard.press('l'); // Enter Phase A's sub-phases

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
