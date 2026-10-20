import { RateLimiter } from "../../services/rateLimiter";

describe("RateLimiter", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows requests up to the configured maximum", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.attempt("a@example.com")).toBe(true);
    expect(limiter.attempt("a@example.com")).toBe(true);
    expect(limiter.attempt("a@example.com")).toBe(true);
  });

  it("rejects a request once the maximum is exceeded within the window", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.attempt("a@example.com")).toBe(true);
    expect(limiter.attempt("a@example.com")).toBe(true);
    expect(limiter.attempt("a@example.com")).toBe(false);
  });

  it("tracks each key independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.attempt("a@example.com")).toBe(true);
    expect(limiter.attempt("b@example.com")).toBe(true);
    expect(limiter.attempt("a@example.com")).toBe(false);
    expect(limiter.attempt("b@example.com")).toBe(false);
  });

  it("allows a request again once the window has elapsed", () => {
    jest.useFakeTimers();
    const limiter = new RateLimiter(1, 60_000);

    expect(limiter.attempt("a@example.com")).toBe(true);
    expect(limiter.attempt("a@example.com")).toBe(false);

    jest.advanceTimersByTime(60_001);

    expect(limiter.attempt("a@example.com")).toBe(true);
  });

  it("clear resets every key", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.attempt("a@example.com");
    limiter.clear();
    expect(limiter.attempt("a@example.com")).toBe(true);
  });

  describe("retryAfterSeconds", () => {
    it("is 0 while the key is under its limit", () => {
      const limiter = new RateLimiter(2, 60_000);
      limiter.attempt("k");
      expect(limiter.retryAfterSeconds("k")).toBe(0);
    });

    it("reports the seconds until the oldest request leaves the window", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const limiter = new RateLimiter(1, 60_000);
      limiter.attempt("k");
      jest.setSystemTime(new Date("2026-01-01T00:00:20Z"));
      expect(limiter.attempt("k")).toBe(false);
      expect(limiter.retryAfterSeconds("k")).toBe(40);
    });
  });

  // #271 — idle keys (an IP or wallet an attacker never reuses) must be
  // evicted, not kept forever: a key's timestamps were only ever pruned
  // when that same key was attempted again.
  describe("sweep", () => {
    it("evicts a key whose newest timestamp has fallen outside the window, keeps a live one", () => {
      const limiter = new RateLimiter(5, 60_000);
      const now = 1_000_000;
      jest.useFakeTimers().setSystemTime(new Date(now - 61_000));
      limiter.attempt("idle");
      jest.setSystemTime(new Date(now - 1_000));
      limiter.attempt("live");

      expect(limiter.sweep(now)).toBe(1);
      expect(limiter.size).toBe(1);
      // The live key's own limiting behaviour is unaffected by the sweep.
      expect(limiter.attempt("live")).toBe(true);
    });

    it("evicts idle keys on a timer with no further attempt() call", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const limiter = new RateLimiter(5, 1000, undefined, 1000);
      limiter.startSweeping();
      limiter.attempt("idle");

      jest.advanceTimersByTime(2000);

      expect(limiter.size).toBe(0);
      limiter.stopSweeping();
    });

    it("does not evict a key that keeps being attempted within the window", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const limiter = new RateLimiter(5, 10_000, undefined, 1000);
      limiter.startSweeping();
      limiter.attempt("active");

      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(1500);
        limiter.attempt("active");
      }

      expect(limiter.size).toBe(1);
      limiter.stopSweeping();
    });

    it("stopSweeping stops further eviction", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const limiter = new RateLimiter(5, 1000, undefined, 1000);
      limiter.startSweeping();
      limiter.stopSweeping();
      limiter.attempt("idle");

      jest.advanceTimersByTime(5000);

      expect(limiter.size).toBe(1);
    });

    it("is bounded when maxKeys is set: a flood of active keys drops the oldest-inserted one", () => {
      const limiter = new RateLimiter(5, 60_000, 3);
      for (const key of ["k1", "k2", "k3", "k4"]) limiter.attempt(key);

      expect(limiter.size).toBe(3);
    });

    it("rate-limiting behaviour for active keys is unchanged by maxKeys being unset", () => {
      const limiter = new RateLimiter(2, 60_000);
      expect(limiter.attempt("a")).toBe(true);
      expect(limiter.attempt("a")).toBe(true);
      expect(limiter.attempt("a")).toBe(false);
    });
  });
});
