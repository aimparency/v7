import { test, expect, Page } from '@playwright/test';
import { finishIdeaCreation } from './test-utils';
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
  await page.waitForSelector('.modal-panel', { timeout: 3000 });
  const phaseNameInput = page.locator('input[placeholder="Enter phase name"]');
  await expect(phaseNameInput).toBeVisible();
  await phaseNameInput.fill(name);
  await phaseNameInput.press('Enter');
  await page.waitForSelector('.modal-panel', { state: 'hidden', timeout: 3000 });
}

async function createIdea(page: Page, text: string) {
  await page.keyboard.press('o');
  await page.waitForSelector('.modal-panel', { timeout: 3000 });
  const ideaInput = page.locator('input[placeholder="Enter idea text"]');
  await expect(ideaInput).toBeVisible();
  await ideaInput.fill(text);
  await ideaInput.press('Enter');
  await finishIdeaCreation(page);
}

async function indentIdea(page: Page) {
  await page.keyboard.press('L');
  await page.waitForTimeout(100); // Wait for animation/update
}

test('search finds deep nested idea and expands path', async ({ page }) => {
  // 1. Load project
  await page.goto('/');
  await page.getByPlaceholder('Enter project folder path...').fill(PROJECT_PATH);
  await page.getByRole('button', { name: 'Open Project' }).click();
  await expect(page.locator('.project-path:not(.bowman-path)')).toHaveText(PROJECT_PATH);
  
  // Wait for main UI
  await page.waitForSelector('.main-split', { timeout: 10000 });
  await page.focus('.app');

  // 2. Create Phase A and Phase B
  await createPhase(page, 'Phase A');
  await createPhase(page, 'Phase B');

  // 3. Create ideas in Phase A
  await page.keyboard.press('k'); // Go up to Phase A
  await page.keyboard.press('i'); // Enter edit mode (navigating ideas)
  
  await createIdea(page, 'Phase A Idea 1');
  await createIdea(page, 'Phase A Idea 2');

  // 4. Create ideas in Phase B
  await page.keyboard.press('Escape'); // Exit edit mode
  await page.keyboard.press('j'); // Go down to Phase B
  await page.keyboard.press('i'); // Enter edit mode

  await createIdea(page, 'Phase B Idea 1');
  await createIdea(page, 'Phase B Idea 2');

  // 5. Create Sub-ideas for Phase B Idea 1
  await page.keyboard.press('k'); // Select Phase B Idea 1
  
  // Create Sub-idea "Idea 1.1" (as sibling then indent)
  await createIdea(page, 'Idea 1.1');
  await indentIdea(page);

  // 6. Create Sub-sub-ideas for Idea 1.1
  // Idea 1.1 is now selected.
  await createIdea(page, 'Idea 1.1.1');
  await indentIdea(page);

  // Create "target idea"
  await createIdea(page, 'target idea');
  // Sibling of 1.1.1, so effectively sub-sub-idea of Idea 1

  // Create "Idea 1.1.3"
  await createIdea(page, 'Idea 1.1.3');

  // 7. Collapse and navigate away
  await page.keyboard.press('h'); // Collapse 1.1 (parent of target)
  await page.keyboard.press('h'); // Collapse Phase B Idea 1
  await page.keyboard.press('Escape'); // Exit idea nav
  
  await page.keyboard.press('k'); // Go to Phase A
  await page.keyboard.press('i'); // Enter idea nav
  await page.keyboard.press('j'); // Go to Idea 2
  
  // 8. Search for 'target idea'
  await page.keyboard.type('/');
  await page.getByPlaceholder('Go to idea...').fill('target idea');
  
  // Wait for results
  await expect(page.locator('.result-item').first()).toContainText('target idea');
  
  // Select it (Enter)
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-overlay', { state: 'hidden' });
  await page.waitForTimeout(200);

  // 9. Verify visibility and expansion
  const targetIdea = page.locator('.idea-text', { hasText: 'target idea' }).last();
  await expect(targetIdea).toBeVisible();
  
  // Check if it's selected
  const targetIdeaItem = page.locator('.idea-item').filter({ 
    has: page.locator('> .idea-content .idea-text', { hasText: /^\s*target idea\s*$/ }) 
  });
  await expect(targetIdeaItem).toHaveClass(/active/);
});

test('search finds deep nested idea after reload', async ({ page }) => {
  // 1. Setup Data
  await page.goto('/');
  await page.getByPlaceholder('Enter project folder path...').fill(PROJECT_PATH);
  await page.getByRole('button', { name: 'Open Project' }).click();
  
  await page.waitForSelector('.main-split', { timeout: 10000 });
  await page.focus('.app');

  // Create Phases
  await createPhase(page, 'Phase A');
  await createPhase(page, 'Phase B');

  // Create Ideas Phase A
  await page.keyboard.press('k'); 
  await page.keyboard.press('i');
  await createIdea(page, 'Phase A Idea 1');
  await createIdea(page, 'Phase A Idea 2');

  // Create Ideas Phase B
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await page.keyboard.press('i');
  await createIdea(page, 'Phase B Idea 1');
  await createIdea(page, 'Phase B Idea 2');

  // Create nested structure
  await page.keyboard.press('k'); // Select Phase B Idea 1
  
  await createIdea(page, 'Idea 1.1');
  await indentIdea(page);

  await createIdea(page, 'Idea 1.1.1');
  await indentIdea(page);

  await createIdea(page, 'target idea');

  await createIdea(page, 'Idea 1.1.3');

  // 2. Reload Page
  await page.reload();
  
  await expect(page.locator('.project-path:not(.bowman-path)')).toHaveText(PROJECT_PATH);
  await page.waitForSelector('.main-split', { timeout: 10000 });
  await page.focus('.app');
  
  // 3. Search for 'target idea'
  await page.keyboard.type('/');
  await page.getByPlaceholder('Go to idea...').fill('target idea');
  
  await expect(page.locator('.result-item').first()).toContainText('target idea');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-overlay', { state: 'hidden' });
  await page.waitForTimeout(200);

  // 4. Verify
  const targetIdea = page.locator('.idea-text', { hasText: 'target idea' }).last();
  await expect(targetIdea).toBeVisible();
  
  const targetIdeaItem = page.locator('.idea-item').filter({ 
    has: page.locator('> .idea-content .idea-text', { hasText: /^\s*target idea\s*$/ }) 
  }).last();
  await expect(targetIdeaItem).toHaveClass(/active/);
});