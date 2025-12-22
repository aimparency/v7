import { test, expect } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { seedProject } from './test-utils';

test.describe('Project Settings Tests', () => {
  let tempDir: string;

  test.beforeEach(async ({ page }) => {
    tempDir = join(tmpdir(), 'aimparency-settings-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    seedProject(tempDir, {
      phases: [
        { name: 'Settings Phase', commitments: [] }
      ],
      aims: []
    });

    await page.goto('http://localhost:4000/');
    const projectInput = page.locator('.project-input');
    await expect(projectInput).toBeVisible({ timeout: 10000 });
    await projectInput.fill(tempDir);
    await projectInput.press('Enter');

    await page.waitForSelector('.main-split', { timeout: 20000 });
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

  test('persist custom aim statuses', async ({ page }) => {
    // Wait for load
    await expect(page.locator('.column-aims')).toBeVisible();

    // Open Settings
    await page.click('button[title="Project Settings"]');
    await expect(page.locator('.modal-header h3')).toHaveText('Project Settings');

    // Add Status
    await page.click('button.add-btn');
    
    // Fill Status
    const lastStatusRow = page.locator('.status-row').last();
    const keyInput = lastStatusRow.locator('.status-key-input');
    await keyInput.clear();
    await keyInput.fill('test-status');
    
    // Note: color inputs can be tricky, but fill often works
    await lastStatusRow.locator('.status-color-input').fill('#ff00ff');

    // Save
    await page.click('button.btn-primary:has-text("Save")');
    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 10000 });

    // Reload
    await page.reload();
    await page.waitForSelector('.main-split', { timeout: 20000 });

    // Open Settings Again
    await page.click('button[title="Project Settings"]');
    await page.waitForTimeout(2000); 
    
    // DEBUG: Print all input values in status rows
    const inputs = await page.locator('.status-key-input').all();
    console.log('Status keys found:', await Promise.all(inputs.map(i => i.inputValue())));
    await page.screenshot({ path: 'settings-debug.png' });

    // Verify key exists - use input value attribute for locator
    const statusInput = page.locator('input.status-key-input').filter({ hasAttribute: ['value', 'test-status'] });
    await expect(statusInput).toBeVisible();
    
    // Verify color
    const statusRows = await page.locator('.status-row').all();
    let found = false;
    for (const row of statusRows) {
        const key = await row.locator('.status-key-input').inputValue();
        if (key === 'test-status') {
            await expect(row.locator('.status-color-input')).toHaveValue('#ff00ff');
            found = true;
            break;
        }
    }
    expect(found).toBe(true);
  });
});
