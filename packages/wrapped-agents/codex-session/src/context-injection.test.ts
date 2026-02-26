import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as path from 'path';
import { SessionMemory, SessionSummary } from './session-memory';

const TEST_PROJECT_PATH = path.join(__dirname, '../.test-context-injection');

test('Context injection - load and format summaries', async () => {
  // Clean up test directory
  await fs.remove(TEST_PROJECT_PATH);

  // Create test session summaries
  const memoryDir = path.join(TEST_PROJECT_PATH, '.bowman', 'memory', 'sessions');
  await fs.ensureDir(memoryDir);

  const summaries: SessionSummary[] = [
    {
      sessionId: '2024-02-20T10-00-00-abc123',
      timestamp: Date.now() - 86400000,
      duration: 600000,
      aimsWorked: ['aim-1'],
      outcomes: 'Fixed cache.db location bug',
      patterns: 'Path normalization pattern is important',
      lessonsLearned: 'Always check cache key consistency',
      rawReflection: 'Context'
    },
    {
      sessionId: '2024-02-21T10-00-00-def456',
      timestamp: Date.now() - 43200000,
      duration: 900000,
      aimsWorked: ['aim-2'],
      outcomes: 'Implemented multi-parent UI support',
      patterns: 'Purple color scheme for parent aims',
      lessonsLearned: 'Component composition works well',
      rawReflection: 'Context 2'
    }
  ];

  for (const summary of summaries) {
    const filePath = path.join(memoryDir, `${summary.sessionId}.json`);
    await fs.writeJson(filePath, summary);
  }

  // Load and format
  const loaded = await SessionMemory.loadRecentSummaries(TEST_PROJECT_PATH, 5);
  assert.equal(loaded.length, 2, 'Should load 2 summaries');

  const formatted = SessionMemory.formatForContext(loaded);
  assert.ok(formatted.includes('Previous Session Insights'), 'Should include header');
  assert.ok(formatted.includes('Fixed cache.db location bug'), 'Should include outcomes from first session');
  assert.ok(formatted.includes('Implemented multi-parent UI support'), 'Should include outcomes from second session');
  assert.ok(formatted.includes('Path normalization pattern is important'), 'Should include patterns');
  assert.ok(formatted.includes('Always check cache key consistency'), 'Should include lessons');

  // Verify token limit (rough estimate: ~4 chars per token)
  const estimatedTokens = formatted.length / 4;
  assert.ok(estimatedTokens < 2500, 'Should stay within reasonable token limit');

  // Clean up
  await fs.remove(TEST_PROJECT_PATH);
});

test('Context injection - empty summaries returns empty string', async () => {
  const formatted = SessionMemory.formatForContext([]);
  assert.equal(formatted, '', 'Should return empty string for no summaries');
});

test('Context injection - limits summary content length', async () => {
  const longSummary: SessionSummary = {
    sessionId: 'test-long',
    timestamp: Date.now(),
    duration: 600000,
    aimsWorked: ['aim-1', 'aim-2', 'aim-3', 'aim-4', 'aim-5'],
    outcomes: 'A'.repeat(500), // Very long outcome
    patterns: 'B'.repeat(500),
    lessonsLearned: 'C'.repeat(500),
    rawReflection: 'Context'
  };

  const formatted = SessionMemory.formatForContext([longSummary]);

  // Each field should be truncated to 200 chars max
  const lines = formatted.split('\n');
  const outcomeLine = lines.find(l => l.includes('Outcomes:'));
  assert.ok(outcomeLine, 'Should have outcomes line');
  assert.ok(outcomeLine!.length < 220, 'Outcome should be truncated'); // 200 + "  - Outcomes: "

  const patternLine = lines.find(l => l.includes('Pattern:'));
  assert.ok(patternLine, 'Should have pattern line');
  assert.ok(patternLine!.length < 220, 'Pattern should be truncated');

  const lessonLine = lines.find(l => l.includes('Lesson:'));
  assert.ok(lessonLine, 'Should have lesson line');
  assert.ok(lessonLine!.length < 220, 'Lesson should be truncated');
});

test('Context injection - limits aim list to 3', async () => {
  const manyAimsSummary: SessionSummary = {
    sessionId: 'test-many-aims',
    timestamp: Date.now(),
    duration: 600000,
    aimsWorked: ['aim-1', 'aim-2', 'aim-3', 'aim-4', 'aim-5', 'aim-6'],
    outcomes: 'Completed many aims',
    patterns: '',
    lessonsLearned: '',
    rawReflection: 'Context'
  };

  const formatted = SessionMemory.formatForContext([manyAimsSummary]);

  const lines = formatted.split('\n');
  const aimsLine = lines.find(l => l.includes('Aims:'));
  assert.ok(aimsLine, 'Should have aims line');

  // Should only include first 3 aims
  assert.ok(aimsLine!.includes('aim-1'), 'Should include aim-1');
  assert.ok(aimsLine!.includes('aim-2'), 'Should include aim-2');
  assert.ok(aimsLine!.includes('aim-3'), 'Should include aim-3');
  assert.ok(!aimsLine!.includes('aim-6'), 'Should not include aim-6');
});
