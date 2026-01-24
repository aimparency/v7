import { test, expect, Page } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

async function setupBlankProject(page: Page, projectPath: string) {
  await page.goto('/');
  await page.waitForSelector('.project-selection', { timeout: 10000 });

  const projectInput = page.locator('.project-input');
  await projectInput.fill(projectPath);
  await projectInput.press('Enter');

  await page.waitForSelector('.main-split', { timeout: 10000 });
  await page.waitForTimeout(1000);
}

test('graph view: create first aim by double-click, then drag to create sub-aim', async ({ page }) => {
  const tempDir = join(tmpdir(), 'aimparency-graph-drag-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  // Capture console errors
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', error => {
    consoleErrors.push(`Page error: ${error.message}`);
  });

  try {
    await setupBlankProject(page, tempDir);

    // Switch to graph view
    await page.keyboard.press('g');
    await page.waitForTimeout(500);

    // Verify we're in graph view
    const graphView = page.locator('.graph-view');
    await expect(graphView).toBeVisible();

    // Get SVG element
    const svg = page.locator('.graph-view svg');
    await expect(svg).toBeVisible();

    // Double-click on empty space to create first aim
    const svgBox = await svg.boundingBox();
    if (!svgBox) throw new Error('SVG not found');

    const centerX = svgBox.x + svgBox.width / 2;
    const centerY = svgBox.y + svgBox.height / 2;

    await page.mouse.dblclick(centerX, centerY);
    await page.waitForTimeout(300);

    // Fill in first aim
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    const aimInput = modal.locator('input[type="text"]').first();
    await aimInput.fill('Root Aim');
    await aimInput.press('Enter');

    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
    await page.waitForTimeout(500);

    // Verify first aim node exists in graph
    const firstNode = page.locator('.graph-node').first();
    await expect(firstNode).toBeVisible();

    // Get the position of the first node
    const firstNodeBox = await firstNode.boundingBox();
    if (!firstNodeBox) throw new Error('First node not found');

    const nodeX = firstNodeBox.x + firstNodeBox.width / 2;
    const nodeY = firstNodeBox.y + firstNodeBox.height / 2;

    // Drag from the first node to create a sub-aim
    // Move to node center, mouse down, drag, mouse up
    await page.mouse.move(nodeX, nodeY);
    await page.mouse.down();

    // Drag to a position below and to the right
    const targetX = nodeX + 200;
    const targetY = nodeY + 150;
    await page.mouse.move(targetX, targetY, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);

    // Modal should appear for the sub-aim
    await expect(modal).toBeVisible({ timeout: 3000 });

    const subAimInput = modal.locator('input[type="text"]').first();
    await subAimInput.fill('Sub Aim');
    await subAimInput.press('Enter');

    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
    await page.waitForTimeout(1000);

    // Verify both nodes exist
    const nodes = page.locator('.graph-node');
    await expect(nodes).toHaveCount(2);

    // Verify a connection link exists
    const links = page.locator('.graph-link');
    await expect(links).toHaveCount(1);

    // Check for console errors (especially NaN errors)
    const nanErrors = consoleErrors.filter(err =>
      err.includes('NaN') ||
      err.includes('Invalid input') ||
      err.includes('expected number, received null')
    );

    if (nanErrors.length > 0) {
      console.error('NaN errors detected:', nanErrors);
      throw new Error('NaN errors in console: ' + nanErrors.join('; '));
    }

  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  }
});

test('graph view: drag from existing node to another existing node creates connection', async ({ page }) => {
  const tempDir = join(tmpdir(), 'aimparency-graph-connect-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    await setupBlankProject(page, tempDir);

    // Switch to graph view
    await page.keyboard.press('g');
    await page.waitForTimeout(500);

    const svg = page.locator('.graph-view svg');
    const svgBox = await svg.boundingBox();
    if (!svgBox) throw new Error('SVG not found');

    // Create first aim
    await page.mouse.dblclick(svgBox.x + 300, svgBox.y + 300);
    await page.waitForTimeout(200);

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await modal.locator('input[type="text"]').first().fill('Parent Aim');
    await modal.locator('input[type="text"]').first().press('Enter');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
    await page.waitForTimeout(500);

    // Create second aim (unconnected)
    await page.mouse.dblclick(svgBox.x + 500, svgBox.y + 300);
    await page.waitForTimeout(200);

    await expect(modal).toBeVisible();
    await modal.locator('input[type="text"]').first().fill('Child Aim');
    await modal.locator('input[type="text"]').first().press('Enter');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 3000 });
    await page.waitForTimeout(500);

    // Verify two nodes exist
    const nodes = page.locator('.graph-node');
    await expect(nodes).toHaveCount(2);

    // Verify no links yet
    let links = page.locator('.graph-link');
    await expect(links).toHaveCount(0);

    // Get node positions
    const firstNode = nodes.first();
    const secondNode = nodes.last();

    const firstBox = await firstNode.boundingBox();
    const secondBox = await secondNode.boundingBox();
    if (!firstBox || !secondBox) throw new Error('Nodes not found');

    // Drag from first to second to create connection
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(1000);

    // Verify link was created
    links = page.locator('.graph-link');
    await expect(links).toHaveCount(1);

    // Check for NaN errors
    const nanErrors = consoleErrors.filter(err =>
      err.includes('NaN') ||
      err.includes('Invalid input') ||
      err.includes('expected number, received null')
    );

    if (nanErrors.length > 0) {
      console.error('NaN errors detected:', nanErrors);
      throw new Error('NaN errors in console: ' + nanErrors.join('; '));
    }

  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  }
});
