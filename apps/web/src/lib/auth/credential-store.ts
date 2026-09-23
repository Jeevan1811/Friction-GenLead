/**
 * Mutable password storage for the allowlisted accounts.
 *
 * The password used to live only as a static AUTH_PASSWORD_HASH env var
 * (see scripts/hash-password.mjs), which meant changing it required
 * hand-editing .env and restarting the process. Self-service password
 * setup/reset needs the app to update its own credential at runtime, so
 * password hashes now live in this small JSON file instead, keyed by
 * email -- still nothing more sensitive than what used to sit in .env (a
 * bcrypt hash, not a plaintext password), but now the app can rewrite an
 * entry itself once an OTP has proven ownership of that account's email.
 *
 * This is NOT open signup -- an email can only ever get an entry here if
 * it's already in AUTH_ALLOWED_EMAILS (env.ts::matchAllowedEmail). This
 * store just remembers each allowed account's *current password*, nothing
 * about who's allowed in the first place.
 *
 * File lives outside anything git-tracks (see .gitignore) and should be
 * chmod 600 on the server, same care as the old .env entry got.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface AccountRecord {
  passwordHash: string;
  updatedAt: string;
}

interface CredentialStore {
  accounts: Record<string, AccountRecord>;
}

function storePath(): string {
  return (
    process.env.AUTH_CREDENTIAL_STORE_PATH ||
    path.join(process.cwd(), "data", "auth-credentials.json")
  );
}

function storeKey(email: string): string {
  return email.trim().toLowerCase();
}

function readStore(): CredentialStore {
  const file = storePath();
  if (!existsSync(file)) {
    return { accounts: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return {
      accounts: parsed && typeof parsed.accounts === "object" && parsed.accounts !== null
        ? parsed.accounts
        : {},
    };
  } catch {
    // A corrupt file must never crash the app, and must never be treated
    // as "any password works" -- fall back to "no accounts have a
    // password yet", which forces the safe path (setup/reset flow) for
    // everyone rather than an open door for anyone.
    return { accounts: {} };
  }
}

function writeStore(store: CredentialStore): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/** Whether this account owner has ever set a password. */
export function isPasswordSet(email: string): boolean {
  return storeKey(email) in readStore().accounts;
}

/** This account's current bcrypt hash, or null if never set. */
export function getPasswordHash(email: string): string | null {
  return readStore().accounts[storeKey(email)]?.passwordHash ?? null;
}

/** Overwrites this account's stored password hash (setup or reset -- same operation). */
export function setPasswordHash(email: string, hash: string): void {
  const store = readStore();
  store.accounts[storeKey(email)] = { passwordHash: hash, updatedAt: new Date().toISOString() };
  writeStore(store);
}
