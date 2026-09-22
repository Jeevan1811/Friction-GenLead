/**
 * In-memory pending-OTP-session store.
 *
 * This is a single-account, low-traffic app with no database — an
 * in-memory Map keyed by a random pending-session token is intentional,
 * not a shortcut. It's process-local, so it does not survive a restart or
 * work across multiple app instances; that's an accepted tradeoff for this
 * deploy shape (one Next.js process on one VPS). If this ever needs to run
 * behind a multi-instance load balancer, swap this for Redis.
 */
import { randomBytes, randomInt } from "node:crypto";

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 3;

interface PendingSession {
  email: string;
  otp: string;
  expiresAt: number;
  attempts: number;
}

const pendingSessions = new Map<string, PendingSession>();

function cleanupExpired(): void {
  const now = Date.now();
  for (const [token, session] of pendingSessions) {
    if (session.expiresAt < now) pendingSessions.delete(token);
  }
}

function generateOtp(): string {
  // crypto.randomInt is cryptographically strong, unlike Math.random().
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

/** Creates a fresh pending session and returns its token + the OTP to email. */
export function createPendingSession(email: string): {
  token: string;
  otp: string;
} {
  cleanupExpired();
  const token = randomBytes(32).toString("hex");
  const otp = generateOtp();
  pendingSessions.set(token, {
    email,
    otp,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });
  return { token, otp };
}

export type OtpVerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "not_found" | "expired" | "too_many_attempts" | "invalid_code"; attemptsRemaining?: number };

/**
 * Checks a submitted code against the pending session. Consumes (deletes)
 * the session on success, on expiry, and once the attempt limit is hit —
 * each of those forces a fresh login rather than leaving a session around
 * to keep guessing against.
 */
export function verifyPendingOtp(token: string, code: string): OtpVerifyResult {
  const session = pendingSessions.get(token);
  if (!session) return { ok: false, reason: "not_found" };

  if (Date.now() > session.expiresAt) {
    pendingSessions.delete(token);
    return { ok: false, reason: "expired" };
  }

  if (session.attempts >= MAX_ATTEMPTS) {
    pendingSessions.delete(token);
    return { ok: false, reason: "too_many_attempts" };
  }

  if (session.otp !== code) {
    session.attempts += 1;
    if (session.attempts >= MAX_ATTEMPTS) {
      pendingSessions.delete(token);
      return { ok: false, reason: "too_many_attempts" };
    }
    return {
      ok: false,
      reason: "invalid_code",
      attemptsRemaining: MAX_ATTEMPTS - session.attempts,
    };
  }

  pendingSessions.delete(token); // one-time use
  return { ok: true, email: session.email };
}

/** Test/debug helper only — not used by the app routes. */
export function _clearAllPendingSessionsForTests(): void {
  pendingSessions.clear();
}
