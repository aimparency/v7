// Counts per key within a window, in memory: a restart forgets. Enough to keep
// one visitor from filling the server; not a defence against many machines.
const HOUR_MS = 60 * 60_000;
const MAX_KEYS = 50_000;
const windows = new Map<string, { count: number; since: number }>();

/** Counts this attempt; false when `key` already used up `limit` in the current window. */
export function withinLimit(bucket: string, key: string, limit: number, windowMs = HOUR_MS, now = Date.now()): boolean {
  if (windows.size > MAX_KEYS) windows.clear(); // keys come from outside: bound the map
  const id = `${bucket}:${key}`;
  const current = windows.get(id);
  if (!current || now - current.since > windowMs) {
    windows.set(id, { count: 1, since: now });
    return true;
  }
  current.count++;
  return current.count <= limit;
}
