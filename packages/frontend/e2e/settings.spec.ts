import { test, expect } from '@playwright/test';
import { createProject } from './test-utils';

test('persist custom aim statuses', async ({ page }) => {
  const projectPath = await createProject();
  await page.goto(`/?path=${encodeURIComponent(projectPath)}`);

  // Wait for load
  await expect(page.locator('.column-aims')).toBeVisible();

  // Open Settings
  await page.click('button[title="Project Settings"]');
  await expect(page.locator('.modal-header h3')).toHaveText('Project Settings');

  // Add Status
  await page.click('button.add-btn');
  
  // Fill Status
  const lastStatusRow = page.locator('.status-row').last();
  await lastStatusRow.locator('.status-key-input').fill('test-status');
  // Note: type="color" inputs in playwright might need special handling or just fill
  await lastStatusRow.locator('.status-color-input').fill('#ff00ff');

  // Save
  await page.click('button.btn-primary:has-text("Save")');
  await expect(page.locator('.modal-overlay')).not.toBeVisible();

  // Reload
  await page.reload();
  await expect(page.locator('.column-aims')).toBeVisible();

  // Open Settings Again
  await page.click('button[title="Project Settings"]');
  
  // Verify
  const statusInput = page.locator('input[value="test-status"]');
  await expect(statusInput).toBeVisible();
  
  const row = page.locator('.status-row', { has: page.locator('input[value="test-status"]') });
  await expect(row.locator('.status-color-input')).toHaveValue('#ff00ff');
});
