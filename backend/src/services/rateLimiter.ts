const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * A minimal in-process, fixed-window rate limiter, no external dependency
 * (no Redis, no express-rate-limit) — appropriate for a single-instance
 * API, mirroring the TtlCache decision in the leaderboard endpoint (#16).
 *
 * Used to rate-limit magic-link requests per email (#15's "Rate-limit
 * link requests per email to prevent abuse").
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxKeys?: number,
    private readonly sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS
  ) {}

  /**
   * Records a request attempt for `key` and returns whether it's allowed
   * under the limit. Old timestamps outside the current window are
   * pruned on every call for the key being attempted, but a key that is
   * never attempted again keeps its (now-stale) entry until the next
   * `sweep()` (see `startSweeping()`), not forever — this mirrors
   * `ChallengeStore`'s own eviction strategy.
   */
  attempt(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (existing.length >= this.maxRequests) {
      this.hits.set(key, existing);
      return false;
    }

    existing.push(now);
    this.hits.set(key, existing);

    if (this.maxKeys !== undefined && this.hits.size > this.maxKeys) {
      this.sweep();
      // Still over the cap (a flood of keys all still within their
      // window): drop the oldest-inserted key regardless of expiry, the
      // same fallback ChallengeStore.set() uses.
      while (this.hits.size > this.maxKeys) {
        const oldest = this.hits.keys().next().value as string;
        this.hits.delete(oldest);
      }
    }

    return true;
  }

  /**
   * Whole seconds (>= 1) until the oldest request in the current window
   * expires and `key` may try again. 0 when `key` is not currently limited.
   */
  retryAfterSeconds(key: string): number {
    const now = Date.now();
    const inWindow = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (inWindow.length < this.maxRequests) return 0;
    return Math.max(1, Math.ceil((inWindow[0] + this.windowMs - now) / 1000));
  }

  /**
   * Removes every key whose newest recorded timestamp has fallen outside
   * the window — an idle key that nobody has attempted again since.
   * Returns how many keys were evicted.
   */
  sweep(now = Date.now()): number {
    let removed = 0;
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const newest = timestamps[timestamps.length - 1];
      if (newest === undefined || newest <= windowStart) {
        this.hits.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Starts the periodic sweep. The timer is unref'd so it never keeps the process alive. */
  startSweeping(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.timer.unref();
  }

  stopSweeping(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get size(): number {
    return this.hits.size;
  }

  clear(): void {
    this.hits.clear();
  }
}
