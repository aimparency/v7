
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_ROOT = path.resolve(__dirname, '../../../.test-tmp');
const TEST_ID = uuidv4();
const PROJECT_DIR = path.join(TMP_ROOT, TEST_ID, '.bowman');

// Helper to write a phase file
async function writePhase(id: string, name: string, from: number, to: number, parent: string | null = null, commitments: string[] = []) {
  await fs.outputJson(path.join(PROJECT_DIR, 'phases', `${id}.json`), {
    id, name, from, to, parent, commitments
  });
}

test.describe('Smart Phase Dates', () => {
  test.beforeAll(async () => {
    // Setup Project Structure
    await fs.ensureDir(path.join(PROJECT_DIR, 'aims'));
    await fs.ensureDir(path.join(PROJECT_DIR, 'phases'));
    await fs.outputJson(path.join(PROJECT_DIR, 'meta.json'), { name: 'Test Project', color: '#ff0000' });
    await fs.outputJson(path.join(PROJECT_DIR, 'system.json'), { computeCredits: 100, funds: 100 });

    // Setup Data: "Departure from Augsburg" scenario
    const PARENT_ID = uuidv4();
    const DAY1_ID = uuidv4();
    const DAY2_ID = uuidv4();

    const PARENT_FROM = 1767567600000; // Mon Jan 05 2026 00:00:00 GMT+0100
    const PARENT_TO = 1768345200000;   // Wed Jan 14 2026 00:00:00 GMT+0100
    
    const DAY1_FROM = 1767567600000;
    const DAY1_TO = 1767654000000;     // Tue Jan 06 2026 00:00:00 GMT+0100

    const DAY2_FROM = 1767654000000;
    const DAY2_TO = 1767740400000;     // Wed Jan 07 2026 00:00:00 GMT+0100

    // Expected Next Start: Wed Jan 07 2026 (1767740400000)

    await writePhase(PARENT_ID, 'Parent Phase', PARENT_FROM, PARENT_TO, null, []);
    await writePhase(DAY1_ID, 'Day 1', DAY1_FROM, DAY1_TO, PARENT_ID, []);
    await writePhase(DAY2_ID, 'Day 2', DAY2_FROM, DAY2_TO, PARENT_ID, []);
  });

  test.afterAll(async () => {
    // await fs.remove(path.join(TMP_ROOT, TEST_ID));
  });

  test('should default to Wednesday (Day 3) when creating next subphase', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    
    // 1. Navigate with project path
    const url = `http://localhost:4000/?path=${encodeURIComponent(PROJECT_DIR)}`;
    console.log('Navigating to:', url);
    await page.goto(url);

    // 2. Select Parent Phase (It should be in the first column)
    // Wait for phases to load
    await page.waitForSelector('.phase-column');
    
    // Click the phase named "Parent Phase"
    await page.click('text=Parent Phase');

    // Navigate right to focus the child column (Column 1)
    // This sets the context so that the new phase is created as a child of "Parent Phase"
    await page.keyboard.press('l');

    // 3. Open Create Modal (press 'o')
    await page.keyboard.press('o');

    // 4. Verify Start Date
    // Expected Date: 2026-01-07
    // Expected Time: 00:00
    
    const startDateInput = page.locator('input[type="date"]').first();
    const startTimeInput = page.locator('.time-input').first(); // TimePicker class

    await expect(startDateInput).toHaveValue('2026-01-07');
    await expect(startTimeInput).toHaveValue('00:00');
  });
});
