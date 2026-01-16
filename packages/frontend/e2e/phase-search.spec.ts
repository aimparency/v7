import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs-extra';

const PROJECT_PATH = path.join(process.cwd(), 'e2e-test-project-phase-search');

test.beforeEach(async () => {
  await fs.remove(PROJECT_PATH);
  await fs.ensureDir(PROJECT_PATH);
});

test.afterEach(async () => {
  await fs.remove(PROJECT_PATH);
});

async function createPhase(page: Page, name: string) {
  // Ensure we are in column mode and not editing anything
  await page.keyboard.press('Escape');
  
  await page.keyboard.press('o');
  await page.waitForSelector('.modal', { timeout: 3000 });
  
  // Verify it's Create mode
  await expect(page.locator('.modal-header h3')).toHaveText('Create New Phase');
  
  const phaseNameInput = page.locator('input[placeholder="Enter phase name"]');
  await expect(phaseNameInput).toBeVisible();
  await phaseNameInput.fill(name);
  await phaseNameInput.press('Enter');
  await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
}

test('edit phase and search for parent phase', async ({ page }) => {
  // 1. Load project
  await page.goto('/');
  await page.getByPlaceholder('Enter project folder path...').fill(PROJECT_PATH);
  await page.getByRole('button', { name: 'Open Project' }).click();
  await expect(page.locator('.project-path')).toHaveText(PROJECT_PATH);
  
  // Wait for main UI
  await page.waitForSelector('.main-split', { timeout: 10000 });
  await page.focus('.app');

  // 2. Create phases: "Parent Candidate" and "Child Phase"
  await createPhase(page, 'Parent Candidate');
  await createPhase(page, 'Child Phase');

  // 3. Select "Child Phase" (it should be the second one)
  // Initially first phase is selected. Press 'j' to go down.
  await page.keyboard.press('j');
  
  // Verify selection
  const childPhaseHeader = page.locator('.phase-container.active .phase-name', { hasText: 'Child Phase' });
  await expect(childPhaseHeader).toBeVisible();

  // 4. Open Edit Modal (press 'e')
  await page.keyboard.press('e');
  await page.waitForSelector('.modal', { timeout: 3000 });
  await expect(page.locator('.modal-header h3')).toHaveText('Edit Phase');
  await expect(page.locator('input[placeholder="Enter phase name"]')).toHaveValue('Child Phase');

  // 5. Click "Add Parent Phase" to open Phase Search Modal
  const addParentBtn = page.locator('.btn-select-parent');
  await expect(addParentBtn).toBeVisible();
  await addParentBtn.click();
  
  // 6. Verify Search Modal
  await page.waitForSelector('.search-overlay', { timeout: 3000 });
  const searchInput = page.locator('.search-overlay input[placeholder="Search phases..."]');
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();

  // 7. Search for "Parent Candidate"
  await searchInput.fill('Parent');
  await page.waitForTimeout(500); // Wait for debounce

  // 8. Select "Parent Candidate" from results
  const resultItem = page.locator('.result-item', { hasText: 'Parent Candidate' });
  await expect(resultItem).toBeVisible();
  await resultItem.click();

  // 9. Verify Modal closed and Parent Updated
  await page.waitForSelector('.search-overlay', { state: 'hidden' });
  await expect(page.locator('.selected-parent')).toHaveText('Parent Candidate');

  // 10. Save changes
  await page.getByRole('button', { name: 'Update' }).click();
  await page.waitForSelector('.modal', { state: 'hidden' });

  // 11. Verify in UI (This might be tricky as UI structure changes with hierarchy)
  // But we can check if data persisted by reloading or inspecting via backend if possible.
  // Ideally, if it became a child, it might move to the next column or disappear from root list depending on view.
  // In the current "columns" view, if we link Child Phase to Parent Candidate, 
  // Parent Candidate is at index 0. Child Phase becomes its child.
  // So column 0 should show Parent Candidate. Column 1 should show Child Phase when Parent Candidate is selected.

  // Select Parent Candidate (index 0)
  await page.keyboard.press('k'); // Go up to Parent Candidate
  const parentPhaseHeader = page.locator('.phase-container.active .phase-name', { hasText: 'Parent Candidate' });
  await expect(parentPhaseHeader).toBeVisible();

  // Check column 1 for Child Phase
  // We need to move focus to column 1 ('l')
  await page.keyboard.press('l');
  
  const nestedChildHeader = page.locator('.phase-column').nth(1).locator('.phase-container .phase-name', { hasText: 'Child Phase' });
  await expect(nestedChildHeader).toBeVisible();
});
