import { test, expect, Page } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'fs';
import { finishAimCreation } from './test-utils';

// The graph draws nodes and links with WebGL, so tests locate nodes through the
// dev-only window.__aimparencyGraph hook and read links from the project files.
function readAims(projectPath: string): any[] {
  const aimsDir = join(projectPath, '.bowman', 'aims');
  return readdirSync(aimsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(aimsDir, file), 'utf8')));
}

function countConnections(projectPath: string): number {
  return readAims(projectPath).reduce((total, aim) => total + (aim.supportingConnections?.length ?? 0), 0);
}

// Waits until the node has settled (camera tracking and layout move it at first).
async function getNodePosition(page: Page, aimText: string): Promise<{ x: number, y: number }> {
  const read = () => page.evaluate((text) => (window as any).__aimparencyGraph?.getNodeClientPosition(text) ?? null, aimText);
  let previous = await read();
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.waitForTimeout(100);
    const current = await read();
    if (previous && current && Math.hypot(current.x - previous.x, current.y - previous.y) < 0.5) return current;
    previous = current;
  }
  throw new Error(`Node "${aimText}" did not settle`);
}

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
    const svg = page.locator('.graph-view > svg.graph-overlay');
    await expect(svg).toBeVisible();

    // Double-click on empty space to create first aim
    const svgBox = await svg.boundingBox();
    if (!svgBox) throw new Error('SVG not found');

    const centerX = svgBox.x + svgBox.width / 2;
    const centerY = svgBox.y + svgBox.height / 2;

    await page.mouse.dblclick(centerX, centerY);
    await page.waitForTimeout(300);

    // Fill in first aim
    const modal = page.locator('.modal-panel');
    await expect(modal).toBeVisible({ timeout: 3000 });

    const aimInput = modal.locator('input[type="text"]').first();
    await aimInput.fill('Root Aim');
    await aimInput.press('Enter');

    await finishAimCreation(page);
    await page.waitForTimeout(500);

    // Verify first aim exists and find its node
    await expect.poll(() => readAims(tempDir).length).toBe(1);
    const { x: nodeX, y: nodeY } = await getNodePosition(page, 'Root Aim');

    // Dragging a selected node draws a connection (an unselected one just moves)
    await page.mouse.click(nodeX, nodeY);
    await page.waitForTimeout(300);

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

    await finishAimCreation(page);
    await page.waitForTimeout(1000);

    // Verify both aims exist and are connected
    await expect.poll(() => readAims(tempDir).length).toBe(2);
    await expect.poll(() => countConnections(tempDir)).toBe(1);

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

    const svg = page.locator('.graph-view > svg.graph-overlay');
    const svgBox = await svg.boundingBox();
    if (!svgBox) throw new Error('SVG not found');

    // Create first aim
    await page.mouse.dblclick(svgBox.x + 300, svgBox.y + 300);
    await page.waitForTimeout(200);

    const modal = page.locator('.modal-panel');
    await expect(modal).toBeVisible();
    await modal.locator('input[type="text"]').first().fill('Parent Aim');
    await modal.locator('input[type="text"]').first().press('Enter');
    await finishAimCreation(page);
    await page.waitForTimeout(500);

    // Create second aim (unconnected)
    await page.mouse.dblclick(svgBox.x + 500, svgBox.y + 300);
    await page.waitForTimeout(200);

    await expect(modal).toBeVisible();
    await modal.locator('input[type="text"]').first().fill('Child Aim');
    await modal.locator('input[type="text"]').first().press('Enter');
    await finishAimCreation(page);
    await page.waitForTimeout(500);

    // Verify two aims exist and no links yet
    await expect.poll(() => readAims(tempDir).length).toBe(2);
    expect(countConnections(tempDir)).toBe(0);

    // Drag from first to second to create connection
    const parentPosition = await getNodePosition(page, 'Parent Aim');
    const childPosition = await getNodePosition(page, 'Child Aim');
    await page.mouse.click(parentPosition.x, parentPosition.y);
    await page.waitForTimeout(300);
    await page.mouse.move(parentPosition.x, parentPosition.y);
    await page.mouse.down();
    await page.mouse.move(childPosition.x, childPosition.y, { steps: 10 });
    await page.mouse.up();

    // Verify link was created
    await expect.poll(() => countConnections(tempDir)).toBe(1);

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

test('graph view: ctrl/shift click for multi-select (range add) and bulk selection bar', async ({ page }) => {
  const tempDir = join(tmpdir(), 'aimparency-graph-multi-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    await setupBlankProject(page, tempDir);

    // Switch to graph view
    await page.keyboard.press('g');
    await page.waitForTimeout(600);

    const graphView = page.locator('.graph-view');
    await expect(graphView).toBeVisible();

    const surface = page.locator('.graph-view > svg, .graph-view canvas').first();
    await expect(surface).toBeVisible({ timeout: 5000 });

    const box = await surface.boundingBox();
    if (!box) throw new Error('No graph surface');

    // Create first aim
    const ax = box.x + box.width * 0.3;
    const ay = box.y + box.height * 0.4;
    await page.mouse.dblclick(ax, ay);
    await page.waitForTimeout(400);
    let modal = page.locator('.modal-panel');
    if (await modal.count() > 0 && await modal.isVisible()) {
      await modal.locator('input[type="text"]').first().fill('GMulti A');
      await modal.locator('input[type="text"]').first().press('Enter');
      await finishAimCreation(page);
    }
    await page.waitForTimeout(500);

    // Create second aim
    const bx = box.x + box.width * 0.7;
    const by = box.y + box.height * 0.55;
    await page.mouse.dblclick(bx, by);
    await page.waitForTimeout(400);
    if (await modal.count() > 0 && await modal.isVisible()) {
      await modal.locator('input[type="text"]').first().fill('GMulti B');
      await modal.locator('input[type="text"]').first().press('Enter');
      await finishAimCreation(page);
    }
    await page.waitForTimeout(600);

    // Ctrl click first
    const firstPosition = await getNodePosition(page, 'GMulti A');
    // mouse.click ignores modifiers, so hold the keys explicitly
    await page.keyboard.down('Control');
    await page.mouse.click(firstPosition.x, firstPosition.y);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);

    // Shift click second (range/add)
    const secondPosition = await getNodePosition(page, 'GMulti B');
    await page.keyboard.down('Shift');
    await page.mouse.click(secondPosition.x, secondPosition.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(400);

    // Check the app-wide bulk selection bar
    const bulkBar = page.locator('.bulk-selection-bar');
    await expect(bulkBar).toContainText('2 selected', { timeout: 2000 });
    await bulkBar.locator('button', { hasText: 'Clear' }).click();
    await expect(bulkBar).toBeHidden({ timeout: 1000 });

  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});
