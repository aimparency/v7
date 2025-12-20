import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs-extra';

const PROJECT_PATH = path.join(process.cwd(), 'e2e-test-project');

test.beforeEach(async () => {
  await fs.remove(PROJECT_PATH);
  await fs.ensureDir(PROJECT_PATH);
});

test.afterEach(async () => {
  await fs.remove(PROJECT_PATH);
});

async function createPhase(page: Page, name: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal', { timeout: 3000 });
  const phaseNameInput = page.locator('input[placeholder="Enter phase name"]');
  await expect(phaseNameInput).toBeVisible();
  await phaseNameInput.fill(name);
  await phaseNameInput.press('Enter');
  await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
}

async function createAim(page: Page, text: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal', { timeout: 3000 });
  const aimInput = page.locator('input[placeholder="Enter aim text"]');
  await expect(aimInput).toBeVisible();
  await aimInput.fill(text);
  await aimInput.press('Enter');
  await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
}

async function indentAim(page: Page) {
  await page.keyboard.press('L');
  await page.waitForTimeout(100); // Wait for animation/update
}

test('search finds deep nested aim and expands path', async ({ page }) => {
  // 1. Load project
  await page.goto('/');
  await page.getByPlaceholder('Enter project folder path...').fill(PROJECT_PATH);
  await page.getByRole('button', { name: 'Open Project' }).click();
  await expect(page.locator('.project-path')).toHaveText(PROJECT_PATH);
  
  // Wait for main UI
  await page.waitForSelector('.main-split', { timeout: 10000 });
  await page.focus('.app');

  // 2. Create Phase A and Phase B
  await createPhase(page, 'Phase A');
  await createPhase(page, 'Phase B');

  // 3. Create aims in Phase A
  await page.keyboard.press('k'); // Go up to Phase A
  await page.keyboard.press('i'); // Enter edit mode (navigating aims)
  
  await createAim(page, 'Phase A Aim 1');
  await createAim(page, 'Phase A Aim 2');

  // 4. Create aims in Phase B
  await page.keyboard.press('Escape'); // Exit edit mode
  await page.keyboard.press('j'); // Go down to Phase B
  await page.keyboard.press('i'); // Enter edit mode

  await createAim(page, 'Phase B Aim 1');
  await createAim(page, 'Phase B Aim 2');

  // 5. Create Sub-aims for Phase B Aim 1
  await page.keyboard.press('k'); // Select Phase B Aim 1
  
  // Create Sub-aim "Aim 1.1" (as sibling then indent)
  await createAim(page, 'Aim 1.1');
  await indentAim(page);

  // 6. Create Sub-sub-aims for Aim 1.1
  // Aim 1.1 is now selected.
  await createAim(page, 'Aim 1.1.1');
  await indentAim(page);

  // Create "target aim"
  await createAim(page, 'target aim');
  // Sibling of 1.1.1, so effectively sub-sub-aim of Aim 1

  // Create "Aim 1.1.3"
  await createAim(page, 'Aim 1.1.3');

  // 7. Collapse and navigate away
  await page.keyboard.press('h'); // Collapse 1.1 (parent of target)
  await page.keyboard.press('h'); // Collapse Phase B Aim 1
  await page.keyboard.press('Escape'); // Exit aim nav
  
  await page.keyboard.press('k'); // Go to Phase A
  await page.keyboard.press('i'); // Enter aim nav
  await page.keyboard.press('j'); // Go to Aim 2
  
  // 8. Search for 'target aim'
  await page.keyboard.type('/');
  await page.getByPlaceholder('Go to aim...').fill('target aim');
  
  // Wait for results
  await expect(page.locator('.result-item').first()).toContainText('target aim');
  
  // Select it (Enter)
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-overlay', { state: 'hidden' });
  await page.waitForTimeout(200);

  // 9. Verify visibility and expansion
  const targetAim = page.locator('.aim-text', { hasText: 'target aim' }).last();
  await expect(targetAim).toBeVisible();
  
  // Check if it's selected
  const targetAimItem = page.locator('.aim-item').filter({ 
    has: page.locator('> .aim-content .aim-text', { hasText: /^target aim$/ }) 
  });
  await expect(targetAimItem).toHaveClass(/selected-outlined/);
});

test('search finds deep nested aim after reload', async ({ page }) => {
  // 1. Setup Data
  await page.goto('/');
  await page.getByPlaceholder('Enter project folder path...').fill(PROJECT_PATH);
  await page.getByRole('button', { name: 'Open Project' }).click();
  
  await page.waitForSelector('.main-split', { timeout: 10000 });
  await page.focus('.app');

  // Create Phases
  await createPhase(page, 'Phase A');
  await createPhase(page, 'Phase B');

  // Create Aims Phase A
  await page.keyboard.press('k'); 
  await page.keyboard.press('i');
  await createAim(page, 'Phase A Aim 1');
  await createAim(page, 'Phase A Aim 2');

  // Create Aims Phase B
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await page.keyboard.press('i');
  await createAim(page, 'Phase B Aim 1');
  await createAim(page, 'Phase B Aim 2');

  // Create nested structure
  await page.keyboard.press('k'); // Select Phase B Aim 1
  
  await createAim(page, 'Aim 1.1');
  await indentAim(page);

  await createAim(page, 'Aim 1.1.1');
  await indentAim(page);

  await createAim(page, 'target aim');

  await createAim(page, 'Aim 1.1.3');

  // 2. Reload Page
  await page.reload();
  
  await expect(page.locator('.project-path')).toHaveText(PROJECT_PATH);
  await page.waitForSelector('.main-split', { timeout: 10000 });
  await page.focus('.app');
  
  // 3. Search for 'target aim'
  await page.keyboard.type('/');
  await page.getByPlaceholder('Go to aim...').fill('target aim');
  
  await expect(page.locator('.result-item').first()).toContainText('target aim');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-overlay', { state: 'hidden' });
  await page.waitForTimeout(200);

  // 4. Verify
  const targetAim = page.locator('.aim-text', { hasText: 'target aim' }).last();
  await expect(targetAim).toBeVisible();
  
  const targetAimItem = page.locator('.aim-item').filter({ 
    has: page.locator('> .aim-content .aim-text', { hasText: /^target aim$/ }) 
  }).last();
  await expect(targetAimItem).toHaveClass(/selected-outlined/);
});