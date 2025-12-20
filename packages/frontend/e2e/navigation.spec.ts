import { test, expect } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { seedProject } from './test-utils';
import { randomUUID } from 'crypto';

test.describe('Navigation Tests', () => {
  let tempDir: string;

  test.beforeEach(async ({ page }) => {
    tempDir = join(tmpdir(), 'aimparency-nav-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    // Seed Data
    const phaseId = randomUUID();
    const aim1Id = randomUUID();
    const aim2Id = randomUUID();
    const aim3Id = randomUUID();
    
    const parentAimId = randomUUID();
    const childAimId = randomUUID();

    seedProject(tempDir, {
      phases: [
        { 
          id: phaseId, 
          name: 'Nav Phase', 
          commitments: [aim1Id, aim2Id, aim3Id, parentAimId] 
        }
      ],
      aims: [
        { id: aim1Id, text: 'Aim 1', committedIn: [phaseId] },
        { id: aim2Id, text: 'Aim 2', committedIn: [phaseId] },
        { id: aim3Id, text: 'Aim 3', committedIn: [phaseId] },
        { 
          id: parentAimId, 
          text: 'Parent Aim', 
          committedIn: [phaseId],
          incoming: [childAimId]
        },
        { id: childAimId, text: 'Child Aim', outgoing: [parentAimId] }
      ]
    });

    await page.goto('/');
    const projectInput = page.locator('.project-input');
    await expect(projectInput).toBeVisible({ timeout: 10000 });
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    await page.waitForSelector('.main-split', { timeout: 20000 });
    await page.waitForTimeout(1000); 
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

  test('Mode Switching and Basic Navigation (j/k)', async ({ page }) => {
    // 1. Initial State: Phase Column selected (Column Nav Mode)
    // The phase 'Nav Phase' should be selected by default as it's the only one (or first).
    // Verify Phase Column has focus style (selected-outlined)
    // Wait, by default selectPhase selects column 0.
    await expect(page.locator('.phase-column').first()).toHaveClass(/selected-outlined/);
    
    // Aims should NOT be selected-outlined yet
    const getAimItem = (text: string) => 
      page.locator('.aim-item').filter({ 
        has: page.locator('> .aim-content .aim-text', { hasText: text, exact: true }) 
      });

    await expect(getAimItem('Aim 1')).not.toHaveClass(/selected-outlined/);

    // 2. Enter Aim Navigation Mode (i)
    await page.keyboard.press('i');
    
    // Verify Aim 1 is now selected (default first)
    await expect(getAimItem('Aim 1')).toHaveClass(/selected-outlined/);
    // Verify Phase Column lost the 'selected-outlined' class? 
    // Actually uiStore says: column is selected AND navigatingAims is true.
    // PhaseColumn.vue: :class="{ 'selected-outlined': isActive, ... }"
    // isActive prop comes from PhaseColumn usage in Root.
    // Let's assume visual feedback works. Focus is on aims.

    // 3. Move Down (j) -> Aim 2
    await page.keyboard.press('j');
    await expect(getAimItem('Aim 2')).toHaveClass(/selected-outlined/);
    await expect(getAimItem('Aim 1')).not.toHaveClass(/selected-outlined/);

    // 4. Move Down (j) -> Aim 3
    await page.keyboard.press('j');
    await expect(getAimItem('Aim 3')).toHaveClass(/selected-outlined/);

    // 5. Move Up (k) -> Aim 2
    await page.keyboard.press('k');
    await expect(getAimItem('Aim 2')).toHaveClass(/selected-outlined/);

    // 6. Exit Aim Mode (Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    
    // Aims should lose focus
    await expect(getAimItem('Aim 2')).not.toHaveClass(/selected-outlined/);
    // Column should have focus
    await expect(page.locator('.phase-column').first()).toHaveClass(/selected-outlined/);
  });

  test('Expansion and Hierarchy Navigation (l/h)', async ({ page }) => {
    const getAimItem = (text: string) => 
      page.locator('.aim-item').filter({ 
        has: page.locator('> .aim-content .aim-text', { hasText: text, exact: true }) 
      });

    // Enter Aim Mode
    await page.keyboard.press('i');

    // Move down to 'Parent Aim' (4th item: Aim 1, Aim 2, Aim 3, Parent)
    // Actually order depends on seedProject implementation of commitments array.
    // We passed commitments: [aim1Id, aim2Id, aim3Id, parentAimId]
    // So 3 j's.
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    
    await expect(getAimItem('Parent Aim')).toHaveClass(/selected-outlined/);

    // 1. Expand (l)
    await page.keyboard.press('l');
    await page.waitForTimeout(500); // Wait for load/expand animation

    // Verify Child is visible
    await expect(getAimItem('Child Aim')).toBeVisible();

    // 2. Move Down (j) - Should enter the expanded child
    await page.keyboard.press('j');
    await expect(getAimItem('Child Aim')).toHaveClass(/selected-outlined/);

    // 3. Collapse (h) - Should collapse Parent and select Parent
    // Note: 'h' on a child collapses the parent if it's the only child or logic dictates?
    // uiStore: "case h: if currentAim... else if path > 1... collapse parent"
    await page.keyboard.press('h');
    await page.waitForTimeout(200);

    // Verify Parent is selected again
    await expect(getAimItem('Parent Aim')).toHaveClass(/selected-outlined/);
    
    // Verify Child is hidden (or parent expanded=false)
    // .expanded class on parent should be gone
    await expect(getAimItem('Parent Aim')).not.toHaveClass(/expanded/);
    await expect(getAimItem('Child Aim')).not.toBeVisible();
  });
});
