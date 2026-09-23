/**
 * Mutable password storage for the single-account login.
 *
 * The password used to live only as a static AUTH_PASSWORD_HASH env var
 * (see scripts/hash-password.mjs), which meant changing it required
 * hand-editing .env and restarting the process. Self-service password
 * setup/reset needs the app to update its own credential at runtime, so
 * the hash now lives in this small JSON file instead -- still nothing
 * more sensitive than what used to sit in .env (a bcrypt hash, not a
 * plaintext password), but now the app can rewrite it itself once an OTP
 * has proven ownership of the account email.
 *
 * File lives outside anything git-tracks (see .gitignore) and should be
 * chmod 600 on the server, same care as the old .env entry got.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface CredentialStore {
  passwordHash: string | null;
  updatedAt: string | null;
}

function storePath(): string {
  return (
    process.env.AUTH_CREDENTIAL_STORE_PATH ||
    path.join(process.cwd(), "data", "auth-credentials.json")
  );
}

function readStore(): CredentialStore {
  const file = storePath();
  if (!existsSync(file)) {
    return { passwordHash: null, updatedAt: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return {
      passwordHash: typeof parsed.passwordHash === "string" ? parsed.passwordHash : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    // A corrupt file must never crash the app, and must never be treated
    // as "any password works" -- fall back to "no password set", which
    // forces the safe path (setup/reset flow) rather than an open door.
    return { passwordHash: null, updatedAt: null };
  }
}

function writeStore(store: CredentialStore): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/** Whether the account owner has ever set a password. */
export function isPasswordSet(): boolean {
  return readStore().passwordHash !== null;
}

/** The current bcrypt hash, or null if no password has been set yet. */
export function getPasswordHash(): string | null {
  return readStore().passwordHash;
}

/** Overwrites the stored password hash (setup or reset -- same operation). */
export function setPasswordHash(hash: string): void {
  writeStore({ passwordHash: hash, updatedAt: new Date().toISOString() });
}
