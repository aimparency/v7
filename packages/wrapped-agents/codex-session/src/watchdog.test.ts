import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchdogService } from './watchdog';

const PROMPT_MARKER = 'Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).';

function createService(currentPromptMarker: string): WatchdogService {
  const service = new WatchdogService({} as any, {} as any, undefined, 1);
  (service as any).currentPromptMarker = currentPromptMarker;
  return service;
}

test('normalizeJsonForParse removes control chars and folds whitespace', () => {
  const service = createService('CURRENT_MARKER');
  const normalized = (service as any).normalizeJsonForParse(
    '{"action":{"type":"send-prompt","text":"a\\t b"}}\n\r\u0001\u0002'
  );

  assert.equal(normalized, '{"action":{"type":"send-prompt","text":"a\\t b"}}');
});

test('extractDecisionJson falls back across candidates when one fails', () => {
  const service = createService('CURRENT_MARKER');
  const screen = [
    `${PROMPT_MARKER}`,
    '{"action":{"type":"compact"}}',
    'CURRENT_MARKER',
    'partial response without json',
  ].join('\n');

  const json = (service as any).extractDecisionJson(screen);
  const parsed = JSON.parse(json);
  assert.equal(parsed.action.type, 'compact');
});

test('extractDecisionJson returns WAIT_FOR_RESPONSE_JSON when marker exists but json is incomplete', () => {
  const service = createService('CURRENT_MARKER');
  const screen = 'CURRENT_MARKER watchdog is still thinking...';

  assert.throws(
    () => (service as any).extractDecisionJson(screen),
    (err: any) => err instanceof Error && err.message === 'WAIT_FOR_RESPONSE_JSON'
  );
});

test('extractDecisionJson handles wrapped newline-in-string payloads', () => {
  const service = createService('CURRENT_MARKER');
  const screen =
    'CURRENT_MARKER {"action":{"type":"send-prompt","text":"Run follow-up 3 now:\nexecute codex watchdog e2e","instruct":true}}';

  const json = (service as any).extractDecisionJson(screen);
  const parsed = JSON.parse(json);
  assert.equal(parsed.action.type, 'send-prompt');
  assert.equal(parsed.action.instruct, true);
  assert.equal(parsed.action.text, 'Run follow-up 3 now: execute codex watchdog e2e');
});
