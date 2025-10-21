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

async function createAim(page: Page, text: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal', { timeout: 3000 });
  // Wait a bit for the modal to fully render
  await page.waitForTimeout(200);
  const aimInput = page.locator('.modal input[type="text"]').first();
  await expect(aimInput).toBeVisible();
  await aimInput.click(); // Ensure focus
  await aimInput.fill(text);
  await page.waitForTimeout(100); // Wait for fill to complete
  await aimInput.press('Enter');
  await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
}

async function getAllAimTexts(page: Page): Promise<string[]> {
  // Get all aim texts including (untitled), then map them
  const aimElements = await page.locator('.aim-content .aim-text').all();
  const texts: string[] = [];
  for (const el of aimElements) {
    const text = await el.textContent();
    if (text && text !== '(untitled)') {
      texts.push(text.trim());
    }
  }
  return texts;
}

test('aim creation with o key inserts after selected aim', async ({ page }) => {
  const tempDir = join(tmpdir(), 'aimparency-test-aim-' + Date.now());
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
    await page.waitForSelector('.main', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Focus the app
    await page.focus('.app');

    // Navigate to phase column and create a phase
    await page.keyboard.press('l');
    await createPhase(page, 'Test Phase');

    // Enter phase-edit mode to create aims
    await page.keyboard.press('i');
    await page.waitForTimeout(500);

    // Create first aim
    await createAim(page, 'Aim 1');
    await page.waitForTimeout(500);

    // Create second aim (should be after Aim 1)
    await createAim(page, 'Aim 2');
    await page.waitForTimeout(500);

    // Create third aim (should be after Aim 2)
    await createAim(page, 'Aim 3');
    await page.waitForTimeout(500);

    // Verify order: should be [Aim 1, Aim 2, Aim 3]
    let aimTexts = await getAllAimTexts(page);
    expect(aimTexts).toEqual(['Aim 1', 'Aim 2', 'Aim 3']);

    // Now select Aim 1 (index 0) and insert after it
    await page.keyboard.press('k'); // Move up to Aim 2
    await page.keyboard.press('k'); // Move up to Aim 1
    await page.waitForTimeout(300);

    // Create a new aim after Aim 1
    await createAim(page, 'Aim 1.5');
    await page.waitForTimeout(500);

    // Verify order: should be [Aim 1, Aim 1.5, Aim 2, Aim 3]
    aimTexts = await getAllAimTexts(page);
    console.log('Console logs:', consoleLogs);
    console.log('Actual aim order:', aimTexts);
    expect(aimTexts).toEqual(['Aim 1', 'Aim 1.5', 'Aim 2', 'Aim 3']);

    // Select Aim 2 (now at index 2) and insert after it
    await page.keyboard.press('j'); // Move down to Aim 1.5
    await page.keyboard.press('j'); // Move down to Aim 2
    await page.waitForTimeout(300);

    await createAim(page, 'Aim 2.5');
    await page.waitForTimeout(500);

    // Verify order: should be [Aim 1, Aim 1.5, Aim 2, Aim 2.5, Aim 3]
    aimTexts = await getAllAimTexts(page);
    expect(aimTexts).toEqual(['Aim 1', 'Aim 1.5', 'Aim 2', 'Aim 2.5', 'Aim 3']);

  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  }
});

test('aim creation with O key inserts before selected aim', async ({ page }) => {
  const tempDir = join(tmpdir(), 'aimparency-test-aim-O-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    await page.goto('/');
    await page.waitForSelector('.project-selection', { timeout: 10000 });

    const projectInput = page.locator('.project-input');
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    await page.waitForSelector('.main', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await page.focus('.app');

    // Create phase and enter phase-edit mode
    await page.keyboard.press('l');
    await createPhase(page, 'Test Phase');
    await page.keyboard.press('i');
    await page.waitForTimeout(500);

    // Create initial aims
    await createAim(page, 'Aim 1');
    await page.waitForTimeout(500);
    await createAim(page, 'Aim 2');
    await page.waitForTimeout(500);
    await createAim(page, 'Aim 3');
    await page.waitForTimeout(500);

    // Verify initial order
    let aimTexts = await getAllAimTexts(page);
    expect(aimTexts).toEqual(['Aim 1', 'Aim 2', 'Aim 3']);

    // Select Aim 2 and insert before it with Shift+O
    await page.keyboard.press('k'); // Move up to Aim 2
    await page.waitForTimeout(300);

    await createAim(page, 'Aim 1.5'); // Uses the helper that works

    // Verify order: should be [Aim 1, Aim 1.5, Aim 2, Aim 3]
    aimTexts = await getAllAimTexts(page);
    expect(aimTexts).toEqual(['Aim 1', 'Aim 1.5', 'Aim 2', 'Aim 3']);

  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  }
});
