import { test, expect, Page } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

async function createPhase(page: Page, name: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal-panel', { timeout: 3000 });
  const phaseNameInput = page.locator('input[placeholder="Enter phase name"]');
  await expect(phaseNameInput).toBeVisible();
  await phaseNameInput.fill(name);
  await phaseNameInput.press('Enter');
  await page.waitForSelector('.modal-panel', { state: 'hidden', timeout: 3000 });
}

test('create first idea in empty phase shows modal and creates idea', async ({ page }) => {
  const tempDir = join(tmpdir(), 'aimparency-test-first-idea-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  // Capture console logs and errors
  const consoleLogs: string[] = [];
  const consoleErrors: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
  });

  page.on('pageerror', error => {
    consoleErrors.push(`Page error: ${error.message}`);
  });

  try {
    // Navigate to the app
    await page.goto('/');
    await page.waitForSelector('.project-selection', { timeout: 10000 });

    // Enter the temporary project path
    const projectInput = page.locator('.project-input');
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    // Wait for the project to load
    await page.waitForSelector('.main-split', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Focus the app
    await page.focus('.app');

    // Navigate to phase column (column 1)
    await page.keyboard.press('l');
    await page.waitForTimeout(300);

    // Create a phase
    await createPhase(page, 'Test Phase');
    await page.waitForTimeout(500);

    // Enter ideas-edit mode for the phase
    console.log('Pressing i to enter ideas-edit mode...');
    await page.keyboard.press('i');
    await page.waitForTimeout(500);

    // Check the current mode via evaluation
    const uiState = await page.evaluate(() => {
      const app = document.querySelector('.app') as any;
      if (app && app.__vue_app__) {
        const store = app.__vue_app__.config.globalProperties.$pinia._s.get('ui');
        return {
          mode: store.mode,
          selectedColumn: store.selectedColumn,
          rootAimsSelectedIndex: store.rootAimsSelectedIndex
        };
      }
      return null;
    });
    console.log('UI State after pressing i:', uiState);

    // Try to create the first idea
    console.log('Pressing o to create first idea...');
    await page.keyboard.press('o');

    // Wait a bit for modal to potentially appear
    await page.waitForTimeout(300);

    // Check if modal appeared
    const modalVisible = await page.locator('.modal-panel').isVisible().catch(() => false);
    console.log('Modal visible:', modalVisible);
    console.log('Console logs:', consoleLogs.filter(log => log.includes('KEYDOWN') || log.includes('idea')));
    console.log('Console errors:', consoleErrors);

    // ASSERTION: Modal should be visible
    await expect(page.locator('.modal-panel')).toBeVisible({ timeout: 3000 });

    // Fill in the idea text
    const ideaInput = page.locator('.modal-panel input[type="text"]').first();
    await expect(ideaInput).toBeVisible();
    await ideaInput.fill('First Idea');
    await ideaInput.press('Enter');

    // Wait for modal to close
    await page.waitForSelector('.modal-panel', { state: 'hidden', timeout: 3000 });
    await page.waitForTimeout(500);

    // ASSERTION: The idea should now be visible
    const ideaTexts = await page.locator('.idea-content .idea-text').allTextContents().then(texts => texts.map(text => text.trim()));
    expect(ideaTexts).toContain('First Idea');

  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  }
});
