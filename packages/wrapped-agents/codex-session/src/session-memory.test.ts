import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as path from 'path';
import { SessionMemory, SessionSummary } from './session-memory';

// Mock Agent class for testing
class MockAgent {
  private content: string;

  constructor(content: string) {
    this.content = content;
  }

  getLines(count: number): string {
    return this.content;
  }
}

const TEST_PROJECT_PATH = path.join(__dirname, '../.test-session-memory');

test('SessionMemory - create and save summary', async () => {
  // Clean up test directory
  await fs.remove(TEST_PROJECT_PATH);

  const sessionMemory = new SessionMemory(TEST_PROJECT_PATH);

  // Create mock agents
  const workerContext = `
Working on aim f1550eb7-d02e-40bc-af94-1fb1076076bd
Fixed cache.db file location issue
All 19 tests passed successfully
Marked aim f1550eb7-d02e-40bc-af94-1fb1076076bd as done
`;
  const mockWorker = new MockAgent(workerContext) as any;
  const mockWatchdog = new MockAgent('') as any;

  // Extract reflection
  const summary = await sessionMemory.extractReflection(mockWorker, mockWatchdog);

  assert.ok(summary, 'Summary should be extracted');
  assert.ok(summary!.sessionId, 'Session ID should be generated');
  assert.ok(summary!.timestamp > 0, 'Timestamp should be set');
  assert.ok(summary!.aimsWorked.includes('f1550eb7-d02e-40bc-af94-1fb1076076bd'), 'Should extract aim ID');
  assert.ok(summary!.outcomes.includes('tests passed') || summary!.outcomes.includes('done'), 'Should extract outcomes');

  // Save summary
  await sessionMemory.saveSummary(summary!);

  // Verify file was created
  const memoryDir = path.join(TEST_PROJECT_PATH, '.bowman', 'memory', 'sessions');
  const files = await fs.readdir(memoryDir);
  assert.ok(files.length > 0, 'Session file should be created');

  // Clean up
  await fs.remove(TEST_PROJECT_PATH);
});

test('SessionMemory - load recent summaries', async () => {
  // Clean up test directory
  await fs.remove(TEST_PROJECT_PATH);

  // Create multiple session summaries
  const memoryDir = path.join(TEST_PROJECT_PATH, '.bowman', 'memory', 'sessions');
  await fs.ensureDir(memoryDir);

  const summaries: SessionSummary[] = [
    {
      sessionId: '2024-02-20T10-00-00-abc123',
      timestamp: Date.now() - 86400000, // 1 day ago
      duration: 600000, // 10 minutes
      aimsWorked: ['aim-1'],
      outcomes: 'Completed feature X',
      patterns: 'Pattern A observed',
      lessonsLearned: 'Lesson 1',
      rawReflection: 'Raw context'
    },
    {
      sessionId: '2024-02-21T10-00-00-def456',
      timestamp: Date.now() - 43200000, // 12 hours ago
      duration: 900000, // 15 minutes
      aimsWorked: ['aim-2', 'aim-3'],
      outcomes: 'Fixed bug Y',
      patterns: 'Pattern B noticed',
      lessonsLearned: 'Lesson 2',
      rawReflection: 'Raw context 2'
    }
  ];

  for (const summary of summaries) {
    const filePath = path.join(memoryDir, `${summary.sessionId}.json`);
    await fs.writeJson(filePath, summary);
  }

  // Load recent summaries
  const loaded = await SessionMemory.loadRecentSummaries(TEST_PROJECT_PATH, 5);

  assert.equal(loaded.length, 2, 'Should load 2 summaries');
  assert.equal(loaded[0].sessionId, '2024-02-21T10-00-00-def456', 'Should load most recent first');

  // Clean up
  await fs.remove(TEST_PROJECT_PATH);
});

test('SessionMemory - format for context', async () => {
  const summaries: SessionSummary[] = [
    {
      sessionId: 'test-1',
      timestamp: Date.now(),
      duration: 600000,
      aimsWorked: ['aim-1', 'aim-2'],
      outcomes: 'Completed testing',
      patterns: 'TDD works well',
      lessonsLearned: 'Write tests first',
      rawReflection: 'Context'
    }
  ];

  const context = SessionMemory.formatForContext(summaries);

  assert.ok(context.includes('Previous Session Insights'), 'Should include header');
  assert.ok(context.includes('Completed testing'), 'Should include outcomes');
  assert.ok(context.includes('aim-1'), 'Should include aim IDs');
  assert.ok(context.includes('TDD works well'), 'Should include patterns');
  assert.ok(context.includes('Write tests first'), 'Should include lessons');
});

test('SessionMemory - extract aim IDs from context', async () => {
  const sessionMemory = new SessionMemory(TEST_PROJECT_PATH);

  const context = `
Worked on aim f1550eb7-d02e-40bc-af94-1fb1076076bd
Also fixed c4ab85c2-0497-48de-ae93-3dc7b4c2aa60
Aim f1550eb7-d02e-40bc-af94-1fb1076076bd marked as done
`;

  const mockWorker = new MockAgent(context) as any;
  const mockWatchdog = new MockAgent('') as any;

  const summary = await sessionMemory.extractReflection(mockWorker, mockWatchdog);

  assert.ok(summary, 'Summary should be extracted');
  assert.ok(summary!.aimsWorked.includes('f1550eb7-d02e-40bc-af94-1fb1076076bd'), 'Should extract first aim');
  assert.ok(summary!.aimsWorked.includes('c4ab85c2-0497-48de-ae93-3dc7b4c2aa60'), 'Should extract second aim');
  assert.equal(summary!.aimsWorked.length, 2, 'Should deduplicate aim IDs');
});
