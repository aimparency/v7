export type SocketControlCategory = 'terminal-input' | 'terminal-resize' | 'watchdog-toggle';

interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}

const BUCKET_CONFIG: Readonly<Record<SocketControlCategory, BucketConfig>> = {
  'terminal-input': { capacity: 200, refillPerSecond: 100 },
  'terminal-resize': { capacity: 30, refillPerSecond: 30 },
  'watchdog-toggle': { capacity: 5, refillPerSecond: 1 },
};

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

/** Per-socket deterministic token buckets for capability-bearing effects. */
export class SocketControlRateLimiter {
  private readonly buckets = new Map<SocketControlCategory, BucketState>();

  constructor(private readonly now: () => number = Date.now) {}

  allow(category: SocketControlCategory): boolean {
    const config = BUCKET_CONFIG[category];
    const currentTime = this.now();
    const state = this.buckets.get(category) ?? {
      tokens: config.capacity,
      lastRefillMs: currentTime,
    };

    // A non-monotonic injected/system clock grants no tokens and cannot make
    // the bucket negative. Keep the prior anchor until time catches up.
    const elapsedMs = Math.max(0, currentTime - state.lastRefillMs);
    if (elapsedMs > 0) {
      state.tokens = Math.min(
        config.capacity,
        state.tokens + (elapsedMs * config.refillPerSecond) / 1000,
      );
      state.lastRefillMs = currentTime;
    }

    this.buckets.set(category, state);
    if (state.tokens < 1) return false;
    state.tokens -= 1;
    return true;
  }
}
