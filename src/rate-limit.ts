import type { RequestHandler } from 'express';

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  /** Injectable clock for tests. */
  readonly nowFn?: () => number;
}

/** Safety valve: sweep stale buckets once the map grows past this many keys. */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Simple in-memory sliding-window rate limiter, keyed by client IP.
 * A backstop against abuse/brute force on a single-owner server —
 * placed BEFORE auth so unauthenticated floods are cut off early.
 * State is per-process, which is fine for one Render instance.
 */
export function rateLimit({ windowMs, max, nowFn = Date.now }: RateLimitOptions): RequestHandler {
  const hits = new Map<string, readonly number[]>();

  const sweep = (now: number): void => {
    if (hits.size <= MAX_TRACKED_KEYS) {
      return;
    }
    for (const [key, timestamps] of hits) {
      if (timestamps.every((t) => now - t >= windowMs)) {
        hits.delete(key);
      }
    }
  };

  return (req, res, next) => {
    const now = nowFn();
    sweep(now);

    const key = req.ip ?? 'unknown';
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (recent.length >= max) {
      hits.set(key, recent);
      const oldest = recent[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.status(429).set('Retry-After', String(retryAfterSeconds)).json({ error: 'rate_limited' });
      return;
    }

    hits.set(key, [...recent, now]);
    next();
  };
}
