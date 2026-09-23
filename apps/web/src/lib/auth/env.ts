/**
 * Required-environment-variable helpers for the auth system.
 *
 * This is a small fixed-allowlist system (not open signup) configured via
 * env vars. There is no safe default for any of these — an empty JWT
 * secret would be a real backdoor — so every accessor throws loudly the
 * moment it's used rather than silently falling back to something
 * insecure. `apps/web/src/instrumentation.ts` also calls `assertAuthEnv()`
 * once at process startup so a misconfigured deploy fails immediately
 * instead of on the first request.
 *
 * AUTH_PASSWORD_HASH is deliberately NOT in this required list anymore --
 * passwords moved to the mutable credential-store.ts (so each account
 * owner can set/reset their own without a redeploy). A fresh deploy
 * legitimately starts with no passwords set yet, which each account owner
 * resolves via the first-login "set your password" flow.
 */

const REQUIRED_AUTH_VARS = [
  "AUTH_ALLOWED_EMAILS",
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

/**
 * The small fixed set of emails allowed to hold an account -- NOT open
 * signup. Comma-separated in AUTH_ALLOWED_EMAILS. There is no UI or API
 * path that adds to this list at runtime; growing or shrinking it is a
 * deploy-time env change only.
 */
export function getAllowedEmails(): string[] {
  return requireEnv("AUTH_ALLOWED_EMAILS")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Case-insensitively matches `email` against the allowlist and returns the
 * canonical form (exactly as configured in AUTH_ALLOWED_EMAILS) if found,
 * or null. Callers use the canonical form as the credential-store key so
 * casing typed at login can never fork one account into two records.
 */
export function matchAllowedEmail(email: string): string | null {
  const needle = email.trim().toLowerCase();
  return getAllowedEmails().find((e) => e.toLowerCase() === needle) ?? null;
}
