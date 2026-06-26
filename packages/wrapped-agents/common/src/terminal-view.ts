import type { Agent } from './agent';

/** Line count the watchdog uses when parsing supervisor replies. */
export const WATCHDOG_PARSER_LINE_COUNT = 500;

export type TerminalKind = 'worker' | 'watchdog';

export interface ParserViewPayload {
  kind: TerminalKind;
  text: string;
  cols: number;
  rows: number;
  lineCount: number;
}

/**
 * Read the same viewport slice the watchdog loop uses (prefers
 * `getViewportLines`, matching `WatchdogService.readAgentLines`).
 */
export function readAgentViewportLines(agent: Agent, count: number): string {
  if (typeof agent.getViewportLines === 'function') {
    return agent.getViewportLines(count);
  }
  return agent.getLines(count);
}

export function buildParserViewPayload(
  agent: Agent,
  kind: TerminalKind,
  count: number = WATCHDOG_PARSER_LINE_COUNT,
): ParserViewPayload {
  const lineCount = Math.min(Math.max(1, count), 10000);
  return {
    kind,
    text: readAgentViewportLines(agent, lineCount),
    cols: agent.terminal.cols,
    rows: agent.terminal.rows,
    lineCount,
  };
}