import { test, expect, Page } from '@playwright/test';
import { finishAimCreation } from './test-utils';
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

async function createAim(page: Page, text: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal-panel', { timeout: 3000 });
  // Wait a bit for the modal to fully render
  await page.waitForTimeout(200);
  const ideaInput = page.locator('.modal-panel input[type="text"]').first();
  await expect(ideaInput).toBeVisible();
  await ideaInput.click(); // Ensure focus
  await ideaInput.fill(text);
  await page.waitForTimeout(100); // Wait for fill to complete
  await ideaInput.press('Enter');
  await finishAimCreation(page);
}

async function getAllAimTexts(page: Page): Promise<string[]> {
  // Get all idea texts including (untitled), then map them
  const ideaElements = await page.locator('.idea-content .idea-text').all();
  const texts: string[] = [];
  for (const el of ideaElements) {
    const text = await el.textContent();
    if (text && text !== '(untitled)') {
      texts.push(text.trim());
    }
  }
  return texts;
}

test('idea creation with o key inserts after selected idea', async ({ page }) => {
  const tempDir = join(tmpdir(), 'aimparency-test-idea-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  // Capture console logs
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    consoleLogs.push(msg.text());
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

    // Navigate to phase column and create a phase
    await page.keyboard.press('l');
    await createPhase(page, 'Test Phase');

    // Enter phase-edit mode to create ideas
    await page.keyboard.press('i');
    await page.waitForTimeout(500);

    // Create first idea
    await createAim(page, 'Idea 1');
    await page.waitForTimeout(500);

    // Create second idea (should be after Idea 1)
    await createAim(page, 'Idea 2');
    await page.waitForTimeout(500);

    // Create third idea (should be after Idea 2)
    await createAim(page, 'Idea 3');
    await page.waitForTimeout(500);

    // Verify order: should be [Idea 1, Idea 2, Idea 3]
    let ideaTexts = await getAllAimTexts(page);
    expect(ideaTexts).toEqual(['Idea 1', 'Idea 2', 'Idea 3']);

    // Now select Idea 1 (index 0) and insert after it
    await page.keyboard.press('k'); // Move up to Idea 2
    await page.keyboard.press('k'); // Move up to Idea 1
    
    // Wait for selection to update
    await expect(page.locator('.idea-item', { hasText: 'Idea 1' }).first()).toHaveClass(/active/);

    // Create a new idea after Idea 1
    await createAim(page, 'Idea 1.5');
    await page.waitForTimeout(500);

    // Verify order: should be [Idea 1, Idea 1.5, Idea 2, Idea 3]
    ideaTexts = await getAllAimTexts(page);
    expect(ideaTexts).toEqual(['Idea 1', 'Idea 1.5', 'Idea 2', 'Idea 3']);

    // Select Idea 2 (now at index 2) and insert after it
    // We are currently at Idea 1.5 (index 1) because createAim selects the new idea.
    await page.keyboard.press('j'); // Move down to Idea 2
    
    // Wait for selection to update
    await expect(page.locator('.idea-item', { hasText: 'Idea 2' }).first()).toHaveClass(/active/);

    await createAim(page, 'Idea 2.5');
    await page.waitForTimeout(500);

    // Verify order: should be [Idea 1, Idea 1.5, Idea 2, Idea 2.5, Idea 3]
    ideaTexts = await getAllAimTexts(page);
    expect(ideaTexts).toEqual(['Idea 1', 'Idea 1.5', 'Idea 2', 'Idea 2.5', 'Idea 3']);

  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  }
});

test('idea creation with O key inserts before selected idea', async ({ page }) => {
  const tempDir = join(tmpdir(), 'aimparency-test-idea-O-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    await page.goto('/');
    await page.waitForSelector('.project-selection', { timeout: 10000 });

    const projectInput = page.locator('.project-input');
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    await page.waitForSelector('.main-split', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await page.focus('.app');

    // Create phase and enter phase-edit mode
    await page.keyboard.press('l');
    await createPhase(page, 'Test Phase');
    await page.keyboard.press('i');
    await page.waitForTimeout(500);

    // Create initial ideas
    await createAim(page, 'Idea 1');
    await page.waitForTimeout(500);
    await createAim(page, 'Idea 2');
    await page.waitForTimeout(500);
    await createAim(page, 'Idea 3');
    await page.waitForTimeout(500);

    // Verify initial order
    let ideaTexts = await getAllAimTexts(page);
    expect(ideaTexts).toEqual(['Idea 1', 'Idea 2', 'Idea 3']);

    // Select Idea 2 (index 1)
    await page.keyboard.press('k'); // Move up to Idea 2 (from Idea 3 created last)
    
    // Wait for selection to update
    await expect(page.locator('.idea-item', { hasText: 'Idea 2' }).first()).toHaveClass(/active/);

    // Create Idea 1.5 BEFORE Idea 2
    await page.keyboard.press('O'); // shift+o
    await page.waitForSelector('.modal-panel', { timeout: 3000 });
    
    // Fill and submit
    const ideaInput = page.locator('.modal-panel input[type="text"]').first();
    await expect(ideaInput).toBeVisible();
    await ideaInput.fill('Idea 1.5');
    await ideaInput.press('Enter');
    await page.waitForSelector('.modal-panel', { state: 'hidden', timeout: 3000 });

    // Verify order: should be [Idea 1, Idea 1.5, Idea 2, Idea 3]
    ideaTexts = await getAllAimTexts(page);
    expect(ideaTexts).toEqual(['Idea 1', 'Idea 1.5', 'Idea 2', 'Idea 3']);

  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  }
});
