export const MAX_TERMINAL_INPUT_BYTES = 64 * 1024;
export const MIN_TERMINAL_DIMENSION = 1;
export const MAX_TERMINAL_DIMENSION = 500;

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export function isWatchdogTogglePayload(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function parseTerminalInput(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (Buffer.byteLength(value, 'utf8') > MAX_TERMINAL_INPUT_BYTES) return undefined;
  return value;
}

export function parseTerminalDimensions(value: unknown): TerminalDimensions | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  if (!Number.isInteger(record.cols) || !Number.isInteger(record.rows)) return undefined;

  const cols = record.cols as number;
  const rows = record.rows as number;
  if (
    cols < MIN_TERMINAL_DIMENSION ||
    cols > MAX_TERMINAL_DIMENSION ||
    rows < MIN_TERMINAL_DIMENSION ||
    rows > MAX_TERMINAL_DIMENSION
  ) {
    return undefined;
  }

  return { cols, rows };
}

export function dispatchWatchdogToggle(
  payload: unknown,
  effect: (enabled: boolean) => void,
): boolean {
  if (!isWatchdogTogglePayload(payload)) return false;
  effect(payload);
  return true;
}

export function dispatchTerminalInput(
  payload: unknown,
  effect: (data: string) => void,
): boolean {
  const data = parseTerminalInput(payload);
  if (data === undefined) return false;
  effect(data);
  return true;
}

export function dispatchTerminalResize(
  payload: unknown,
  effect: (dimensions: TerminalDimensions) => void,
): boolean {
  const dimensions = parseTerminalDimensions(payload);
  if (dimensions === undefined) return false;
  effect(dimensions);
  return true;
}
