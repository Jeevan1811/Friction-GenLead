/**
 * In-memory fixed-window rate limiter for the login endpoint.
 *
 * Keyed by client IP. Same "in-memory is fine at this scale" reasoning as
 * otp-store.ts — single process, single account, low traffic.
 */
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitStatus {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/** Checks whether `key` is currently allowed to attempt a login. */
export function checkRateLimit(key: string): RateLimitStatus {
  const bucket = buckets.get(key);
  const now = Date.now();

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    return { allowed: true };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000)
    );
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true };
}

/** Records a failed login attempt for `key`, starting a new window if needed. */
export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }

  bucket.count += 1;
}

/** Clears the counter for `key` — called after a fully successful login. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test/debug helper only — not used by the app routes. */
export function _clearAllRateLimitsForTests(): void {
  buckets.clear();
}
