/**
 * Required-environment-variable helpers for the auth system.
 *
 * This is a single-account system configured entirely via env vars. There
 * is no safe default for any of these — an empty JWT secret would be a
 * real backdoor — so every accessor throws loudly the moment it's used
 * rather than silently falling back to something insecure.
 * `apps/web/src/instrumentation.ts` also calls `assertAuthEnv()` once at
 * process startup so a misconfigured deploy fails immediately instead of
 * on the first request.
 *
 * AUTH_PASSWORD_HASH is deliberately NOT in this required list anymore --
 * the password hash moved to the mutable credential-store.ts (so the
 * account owner can set/reset it themselves without a redeploy). A fresh
 * deploy legitimately starts with no password set yet, which the account
 * owner resolves via the first-login "set your password" flow.
 */

const REQUIRED_AUTH_VARS = [
  "AUTH_EMAIL",
  "AUTH_JWT_SECRET",
] as const;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. Refusing to operate ` +
        `without it — see apps/web/.env.example.`
    );
  }
  return value;
}

/**
 * Validates the core auth env vars are present. Called from
 * instrumentation.ts at boot, and safe to call again anywhere that wants
 * a fail-fast check before doing auth work.
 */
export function assertAuthEnv(): void {
  for (const name of REQUIRED_AUTH_VARS) {
    requireEnv(name);
  }
}
