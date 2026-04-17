import { test, expect, Page } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import { seedProject } from './test-utils';

async function openProject(page: Page, projectPath: string) {
  await page.goto('/');
  const projectInput = page.locator('.project-input');
  await expect(projectInput).toBeVisible({ timeout: 10000 });
  await projectInput.fill(projectPath);
  await projectInput.press('Enter');
  await page.waitForSelector('.main-split', { timeout: 20000 });
  await page.focus('.app');
}

async function getSelectedPhasePath(page: Page) {
  return await page.locator('.phase-container.selected .phase-name').allTextContents();
}

async function isHorizontallyVisible(page: Page, locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  if (!box) return false;
  const viewport = page.viewportSize();
  const viewportWidth = viewport?.width ?? 1280;
  return box.x + box.width > 0 && box.x < viewportWidth;
}

test.describe('Reload restore', () => {
  let tempDir: string;

  test.beforeEach(async ({ page }) => {
    tempDir = join(tmpdir(), 'aimparency-reload-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    const rootAId = randomUUID();
    const rootBId = randomUUID();
    const childAId = randomUUID();
    const childBId = randomUUID();
    const grandchildAId = randomUUID();
    const grandchildBId = randomUUID();

    seedProject(tempDir, {
      meta: {
        rootPhaseIds: [rootAId, rootBId],
        dataModelVersion: 2
      },
      phases: [
        {
          id: rootAId,
          name: 'Root A',
          parent: null,
          childPhaseIds: [childAId]
        },
        {
          id: rootBId,
          name: 'Root B',
          parent: null,
          childPhaseIds: [childBId]
        },
        {
          id: childAId,
          name: 'Child A',
          parent: rootAId,
          childPhaseIds: [grandchildAId]
        },
        {
          id: childBId,
          name: 'Child B',
          parent: rootBId,
          childPhaseIds: [grandchildBId]
        },
        {
          id: grandchildAId,
          name: 'Grandchild A',
          parent: childAId,
          childPhaseIds: []
        },
        {
          id: grandchildBId,
          name: 'Grandchild B',
          parent: childBId,
          childPhaseIds: []
        }
      ]
    });

    await openProject(page, tempDir);
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

  test('restores selected phase path and active/visible columns after page reload', async ({ page }) => {
    await expect(page.locator('.column-panel.active .phase-container.selected .phase-name')).toHaveText('Root A');

    await page.keyboard.press('j');
    await expect(page.locator('.column-panel.active .phase-container.selected .phase-name')).toHaveText('Root B');

    await page.keyboard.press('l');
    await expect(page.locator('.column-panel.active .phase-container.selected .phase-name')).toHaveText('Child B');

    await page.keyboard.press('l');
    await expect(page.locator('.column-panel.active .phase-container.selected .phase-name')).toHaveText('Grandchild B');

    const selectedPathBeforeReload = await getSelectedPhasePath(page);
    expect(selectedPathBeforeReload).toEqual(['Root B', 'Child B', 'Grandchild B']);

    const activeColumnBeforeReload = await page.locator('.column-panel.active .phase-container.selected .phase-name').textContent();
    expect(activeColumnBeforeReload).toBe('Grandchild B');

    const selectedRootBeforeReload = page.locator('.phase-container.selected .phase-name', { hasText: /^Root B$/ });
    const selectedChildBeforeReload = page.locator('.phase-container.selected .phase-name', { hasText: /^Child B$/ });
    const selectedGrandchildBeforeReload = page.locator('.phase-container.selected .phase-name', { hasText: /^Grandchild B$/ });

    expect(await isHorizontallyVisible(page, selectedRootBeforeReload)).toBe(false);
    expect(await isHorizontallyVisible(page, selectedChildBeforeReload)).toBe(true);
    expect(await isHorizontallyVisible(page, selectedGrandchildBeforeReload)).toBe(true);

    await page.reload();
    await page.waitForSelector('.main-split', { timeout: 20000 });
    await page.focus('.app');

    await expect(page.locator('.column-panel.active .phase-container.selected .phase-name')).toHaveText('Grandchild B');

    const selectedPathAfterReload = await getSelectedPhasePath(page);
    expect(selectedPathAfterReload).toEqual(selectedPathBeforeReload);

    const activeColumnAfterReload = await page.locator('.column-panel.active .phase-container.selected .phase-name').textContent();
    expect(activeColumnAfterReload).toBe(activeColumnBeforeReload);

    const selectedRootAfterReload = page.locator('.phase-container.selected .phase-name', { hasText: /^Root B$/ });
    const selectedChildAfterReload = page.locator('.phase-container.selected .phase-name', { hasText: /^Child B$/ });
    const selectedGrandchildAfterReload = page.locator('.phase-container.selected .phase-name', { hasText: /^Grandchild B$/ });

    expect(await isHorizontallyVisible(page, selectedRootAfterReload)).toBe(false);
    expect(await isHorizontallyVisible(page, selectedChildAfterReload)).toBe(true);
    expect(await isHorizontallyVisible(page, selectedGrandchildAfterReload)).toBe(true);
  });
});
