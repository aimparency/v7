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

async function getColumnsTransform(page: Page) {
  return await page.locator('.columns-layout').evaluate((element) => getComputedStyle(element).transform);
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

  test('restores selected phase path and column window after page reload', async ({ page }) => {
    await page.keyboard.press('j');
    await page.keyboard.press('l');
    await page.keyboard.press('l');

    await expect(page.locator('.column-panel.active .phase-container.selected .phase-name')).toHaveText('Grandchild B');

    const selectedPathBeforeReload = await getSelectedPhasePath(page);
    expect(selectedPathBeforeReload).toEqual(['Root B', 'Child B', 'Grandchild B']);

    const transformBeforeReload = await getColumnsTransform(page);
    expect(transformBeforeReload).not.toBe('none');

    await page.reload();
    await page.waitForSelector('.main-split', { timeout: 20000 });
    await page.focus('.app');

    await expect(page.locator('.column-panel.active .phase-container.selected .phase-name')).toHaveText('Grandchild B');

    const selectedPathAfterReload = await getSelectedPhasePath(page);
    expect(selectedPathAfterReload).toEqual(selectedPathBeforeReload);

    const transformAfterReload = await getColumnsTransform(page);
    expect(transformAfterReload).toBe(transformBeforeReload);
  });
});
