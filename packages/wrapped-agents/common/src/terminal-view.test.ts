import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent } from './agent';
import {
  buildParserViewPayload,
  readAgentViewportLines,
  WATCHDOG_PARSER_LINE_COUNT,
} from './terminal-view';

test('readAgentViewportLines prefers getViewportLines over getLines', () => {
  const agent = {
    getViewportLines: (n: number) => `viewport:${n}`,
    getLines: (n: number) => `lines:${n}`,
  } as unknown as Agent;

  assert.equal(readAgentViewportLines(agent, 12), 'viewport:12');
});

test('buildParserViewPayload returns viewport text and dimensions', () => {
  const agent = {
    getViewportLines: () => 'supervisor tail',
    getLines: () => 'unused',
    terminal: { cols: 100, rows: 40 },
  } as unknown as Agent;

  const payload = buildParserViewPayload(agent, 'watchdog', WATCHDOG_PARSER_LINE_COUNT);
  assert.equal(payload.kind, 'watchdog');
  assert.equal(payload.text, 'supervisor tail');
  assert.equal(payload.cols, 100);
  assert.equal(payload.rows, 40);
  assert.equal(payload.lineCount, WATCHDOG_PARSER_LINE_COUNT);
});